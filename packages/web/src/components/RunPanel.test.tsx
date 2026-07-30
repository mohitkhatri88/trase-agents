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

function stubRunSnapshot(status: RunStatus) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 7,
            taskId: 1,
            status,
            startedAt: "",
            finishedAt: null,
            error: null,
            cancelRequested: false,
            events: [{ id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
}

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
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    unmount();

    render(<StatusBadge status="completed" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
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
      expect(screen.getByTestId("status-badge")).toHaveAttribute("data-status", "completed"),
    );
  });

  it("shows Cancel while active and swaps to Run once finished", async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    act(() => {
      MockEventSource.latest().emit("run.status", {
        id: 2, runId: 7, seq: 2, ts: "", type: "status", message: "completed",
      });
      MockEventSource.latest().emit("done", { runId: 7 });
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument(),
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
    expect(screen.getByTestId("status-badge")).toHaveAttribute("data-status", "failed");
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
