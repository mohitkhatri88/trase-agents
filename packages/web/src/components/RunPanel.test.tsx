import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RunStatus, TaskWithAgent } from "@trase/core";
import { MockEventSource } from "../test-setup.js";
import { StatusBadge } from "./StatusBadge.js";
import { RunPanel } from "./RunPanel.js";

const baseTask: TaskWithAgent = {
  id: 1,
  title: "Parse invoices",
  description: "42 PDFs",
  agentId: 1,
  createdAt: "",
  agent: { id: 1, name: "Invoice Parser" },
  status: "running",
  latestRunId: 7,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const run = (over: Record<string, unknown> = {}) => ({
  id: 7,
  taskId: 1,
  status: "running",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  error: null,
  cancelRequested: false,
  ...over,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Answers both routes the panel needs: the run snapshot and the task detail
 *  that carries run history. */
function stubApi(status: RunStatus, runs: Array<Record<string, unknown>> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/runs/")) {
        return json({
          ...run({ status }),
          events: [{ id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued" }],
        });
      }

      return json({ ...baseTask, runs: runs.length > 0 ? runs : [run({ status })] });
    }),
  );
}

const stubRunSnapshot = (status: RunStatus) => stubApi(status);

const renderPanel = (task: TaskWithAgent = baseTask) =>
  render(<RunPanel task={task} />, { wrapper });

beforeEach(() => {
  MockEventSource.reset();
  stubRunSnapshot("running");
});

afterEach(() => vi.unstubAllGlobals());

describe("StatusBadge", () => {
  it("renders a human label for every status", () => {
    const cases: Array<[RunStatus | "never_run", string]> = [
      ["never_run", "Never run"],
      ["queued", "Queued"],
      ["running", "Running"],
      ["completed", "Succeeded"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ];

    for (const [status, label] of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByTestId("status-badge")).toHaveTextContent(label);
      unmount();
    }
  });

  it("marks in-flight statuses as busy and finished ones as not", () => {
    const { unmount } = render(<StatusBadge status="running" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute("aria-busy", "true");
    unmount();

    render(<StatusBadge status="completed" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute("aria-busy", "false");
  });

  it("is only a live region when explicitly asked to be", () => {
    // A live region per task row would make the polled list announce
    // continuously to a screen reader, so only the focused run panel opts in.
    const { unmount } = render(<StatusBadge status="running" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();

    render(<StatusBadge status="running" live />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("RunPanel", () => {
  it("offers Run and no log for a task that has never run", () => {
    renderPanel({ ...baseTask, status: "never_run", latestRunId: null });

    expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
    expect(screen.queryByTestId("run-log")).not.toBeInTheDocument();
    expect(screen.getByText(/has not run yet/i)).toBeInTheDocument();
  });

  it("seeds the log from the REST snapshot before streaming", async () => {
    renderPanel();
    expect(await screen.findByText("queued")).toBeInTheDocument();
  });

  it("opens the stream from the snapshot cursor, not from zero", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.latest().url).toContain("since=1");
  });

  it("appends streamed log lines in order", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.latest().emit("run.log", {
        id: 2, runId: 7, seq: 2, ts: "", type: "log", message: "Fetching document…",
      });
      MockEventSource.latest().emit("run.log", {
        id: 3, runId: 7, seq: 3, ts: "", type: "log", message: "Fetching document — done",
      });
    });

    const log = await screen.findByTestId("run-log");
    expect(log).toHaveTextContent("Fetching document…");
    expect(log).toHaveTextContent("Fetching document — done");
    expect(log.children).toHaveLength(3);
  });

  it("ignores a duplicate replayed event", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      // seq 1 already arrived in the snapshot.
      MockEventSource.latest().emit("run.status", {
        id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued",
      });
    });

    expect((await screen.findByTestId("run-log")).children).toHaveLength(1);
  });

  it("reflects a status change in the badge", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.latest().emit("run.status", {
        id: 2, runId: 7, seq: 2, ts: "", type: "status", message: "completed",
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-run-status")).toHaveAttribute("data-status", "completed"),
    );
  });

  it("shows Cancel while active and swaps to Run once finished", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();

    act(() => {
      MockEventSource.latest().emit("run.status", {
        id: 2, runId: 7, seq: 2, ts: "", type: "status", message: "completed",
      });
      MockEventSource.latest().emit("done", { runId: 7 });
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
  });

  it("offers Retry and shows the error after a failed run", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.latest().emit("run.error", {
        id: 2, runId: 7, seq: 2, ts: "", type: "error", message: "Extracting fields failed",
      });
      MockEventSource.latest().emit("run.status", {
        id: 3, runId: 7, seq: 3, ts: "", type: "status", message: "failed",
      });
      MockEventSource.latest().emit("done", { runId: 7 });
    });

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("Extracting fields failed")).toBeInTheDocument();
    expect(screen.getByTestId("current-run-status")).toHaveAttribute("data-status", "failed");
  });

  it("closes the stream when the run signals done", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.latest().emit("done", { runId: 7 });
    });

    await waitFor(() => expect(MockEventSource.latest().closed).toBe(true));
  });

  it("never opens a stream for an already-finished run", async () => {
    stubRunSnapshot("completed");
    renderPanel({ ...baseTask, status: "completed" });

    await screen.findByTestId("run-log");
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("closes the stream on unmount", async () => {
    const { unmount } = renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    unmount();
    expect(MockEventSource.latest().closed).toBe(true);
  });
});

describe("run history", () => {
  const historyRuns = [
    { ...run({ id: 7, status: "failed", error: "Extracting fields failed", finishedAt: new Date().toISOString() }) },
    { ...run({ id: 6, status: "completed", finishedAt: new Date().toISOString() }) },
    { ...run({ id: 5, status: "cancelled", finishedAt: new Date().toISOString() }) },
  ];

  it("is hidden when a task has only ever run once", async () => {
    stubApi("completed", [run({ id: 7, status: "completed" })]);
    renderPanel({ ...baseTask, status: "completed" });

    await screen.findByTestId("run-log");
    expect(screen.queryByTestId("run-history")).not.toBeInTheDocument();
  });

  it("lists every attempt, newest first, once there is more than one", async () => {
    stubApi("failed", historyRuns);
    renderPanel({ ...baseTask, status: "failed" });

    const items = await screen.findAllByTestId("run-history-item");
    expect(items).toHaveLength(3);
    // Newest first, and numbered so the oldest attempt reads as #1.
    expect(items[0]).toHaveAttribute("data-run-id", "7");
    expect(items[2]).toHaveAttribute("data-run-id", "5");
    expect(items[0]).toHaveTextContent("#3");
    expect(items[2]).toHaveTextContent("#1");
  });

  it("surfaces the error of a failed attempt in the list", async () => {
    stubApi("failed", historyRuns);
    renderPanel({ ...baseTask, status: "failed" });

    const items = await screen.findAllByTestId("run-history-item");
    expect(items[0]).toHaveTextContent("Extracting fields failed");
  });

  it("marks which attempt is currently on screen", async () => {
    stubApi("failed", historyRuns);
    renderPanel({ ...baseTask, status: "failed" });

    const items = await screen.findAllByTestId("run-history-item");
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("shows a way back to the live run after selecting an older one", async () => {
    stubApi("failed", historyRuns);
    renderPanel({ ...baseTask, status: "failed" });

    const items = await screen.findAllByTestId("run-history-item");
    act(() => {
      items[1]!.click();
    });

    expect(await screen.findByRole("button", { name: /back to latest run/i })).toBeInTheDocument();
  });

  it("never offers Cancel while an older attempt is on screen", async () => {
    // The task is live, but the run being viewed is a finished one — Cancel
    // belongs to the live run only.
    stubApi("running", historyRuns);
    renderPanel();

    const items = await screen.findAllByTestId("run-history-item");
    act(() => {
      items[2]!.click();
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument(),
    );
  });
});
