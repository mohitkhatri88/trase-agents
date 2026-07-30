import { test, expect } from "@playwright/test";

/**
 * These intercept the network instead of driving the real server.
 *
 * They cover states a healthy backend will not produce on demand — outages,
 * empty datasets, slow responses, malformed streams — and they make each one
 * exactly reproducible rather than something you hope to catch.
 */

const AGENTS = [
  { id: 1, name: "Mock Parser", description: "Extracts things", createdAt: "" },
  { id: 2, name: "Mock Summariser", description: "Condenses legal text", createdAt: "" },
];

const task = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Mocked task",
  description: "from a route handler",
  agentId: 1,
  createdAt: "",
  agent: { id: 1, name: "Mock Parser" },
  status: "never_run",
  latestRunId: null,
  ...over,
});

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const STATS = { agents: 2, tasks: 1, runs: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } };

test.describe("error handling", () => {
  test("shows an inline error with a retry when the agent list fails", async ({ page }) => {
    // The query client is configured with retry: 1, so the FIRST failure is
    // retried automatically and never reaches the user. Both attempts have to
    // fail before an error surfaces — which is the behaviour we want, and the
    // reason this test failed the first time it was written.
    let attempts = 0;
    await page.route("**/api/agents", async (route) => {
      attempts += 1;
      if (attempts <= 2) {
        await route.fulfill(
          json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500),
        );
      } else {
        await route.fulfill(json(AGENTS));
      }
    });
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));

    await page.goto("/agents");

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Something went wrong");

    // Retrying actually recovers rather than just re-rendering the error.
    await alert.getByRole("button", { name: /try again/i }).click();
    await expect(page.getByTestId("agent-card")).toHaveCount(2);
  });

  test("surfaces a 409 when the task is already running", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json(AGENTS)));
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/tasks?agent_id=1", (route) => route.fulfill(json([task()])));
    await page.route("**/api/tasks/1/run", (route) =>
      route.fulfill(
        json(
          { error: { code: "RUN_IN_PROGRESS", message: "This task already has a run in progress" } },
          409,
        ),
      ),
    );

    await page.goto("/agents/1");
    const row = page.getByTestId("task-row").first();
    await row.getByRole("button", { expanded: false }).click();
    await row.getByRole("button", { name: /^run$/i }).click();

    await expect(row.getByRole("alert")).toContainText("already has a run in progress");
  });

  test("reports a rejected task creation without losing what was typed", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json(AGENTS)));
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/tasks?agent_id=1", (route) => route.fulfill(json([])));
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill(
        json({ error: { code: "AGENT_NOT_FOUND", message: "No agent with id 99" } }, 400),
      );
    });

    await page.goto("/agents/1");
    await page.getByLabel("Task title").fill("Doomed task");
    await page.getByLabel("Task description").fill("will be rejected");
    await page.getByRole("button", { name: /create task/i }).click();

    await expect(page.getByRole("alert")).toContainText("No agent with id 99");
    // The user's input survives the failure — nothing to retype.
    await expect(page.getByLabel("Task title")).toHaveValue("Doomed task");
  });
});

test.describe("empty and loading states", () => {
  test("shows an empty state rather than a blank pane when there are no agents", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json([])));
    await page.route("**/api/stats", (route) => route.fulfill(json({ ...STATS, agents: 0 })));

    await page.goto("/agents");
    await expect(page.getByText(/no agents yet/i)).toBeVisible();
  });

  test("shows an empty state for an agent with no tasks", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json(AGENTS)));
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/tasks?agent_id=1", (route) => route.fulfill(json([])));

    await page.goto("/agents/1");
    await expect(page.getByText(/no tasks for this agent yet/i)).toBeVisible();
  });

  test("shows skeletons while the agent list is in flight", async ({ page }) => {
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/agents", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill(json(AGENTS));
    });

    await page.goto("/agents");
    await expect(page.getByLabel("Loading")).toBeVisible();
    await expect(page.getByTestId("agent-card")).toHaveCount(2);
    await expect(page.getByLabel("Loading")).toHaveCount(0);
  });
});

test.describe("streaming edge cases", () => {
  /** Serves a scripted SSE body, so the client can be driven frame by frame. */
  const streamOf = (frames: string[]) => ({
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
    body: frames.join(""),
  });

  const frame = (event: string, data: unknown, id?: number) =>
    `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  test("recovers from a gap in the sequence by refetching", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json(AGENTS)));
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/tasks?agent_id=1", (route) =>
      route.fulfill(json([task({ status: "running", latestRunId: 7 })])),
    );

    let snapshots = 0;
    await page.route("**/api/runs/7", async (route) => {
      snapshots += 1;
      // The second snapshot is the recovery fetch, and it carries the events
      // the client never saw on the wire.
      const events =
        snapshots === 1
          ? [{ id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued" }]
          : [
              { id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued" },
              { id: 2, runId: 7, seq: 2, ts: "", type: "status", message: "running" },
              { id: 3, runId: 7, seq: 3, ts: "", type: "log", message: "Recovered line" },
              { id: 4, runId: 7, seq: 4, ts: "", type: "status", message: "completed" },
            ];
      await route.fulfill(
        json({
          id: 7,
          taskId: 1,
          status: snapshots === 1 ? "running" : "completed",
          startedAt: "",
          finishedAt: null,
          error: null,
          cancelRequested: false,
          events,
        }),
      );
    });

    // Jump straight from seq 1 to seq 5 — the client must notice and refetch
    // rather than silently rendering an incomplete log.
    await page.route("**/api/runs/7/events**", (route) =>
      route.fulfill(
        streamOf([
          frame("run.log", { id: 5, runId: 7, seq: 5, ts: "", type: "log", message: "Way ahead" }, 5),
        ]),
      ),
    );

    await page.goto("/agents/1");
    const row = page.getByTestId("task-row").first();
    await row.getByRole("button", { expanded: false }).click();

    await expect(row.getByTestId("run-log")).toContainText("Recovered line");
    expect(snapshots).toBeGreaterThan(1);
  });

  test("renders an error frame distinctly from a log frame", async ({ page }) => {
    await page.route("**/api/agents", (route) => route.fulfill(json(AGENTS)));
    await page.route("**/api/stats", (route) => route.fulfill(json(STATS)));
    await page.route("**/api/tasks?agent_id=1", (route) =>
      route.fulfill(json([task({ status: "running", latestRunId: 7 })])),
    );
    await page.route("**/api/runs/7", (route) =>
      route.fulfill(
        json({
          id: 7, taskId: 1, status: "running", startedAt: "", finishedAt: null,
          error: null, cancelRequested: false,
          events: [{ id: 1, runId: 7, seq: 1, ts: "", type: "status", message: "queued" }],
        }),
      ),
    );
    await page.route("**/api/runs/7/events**", (route) =>
      route.fulfill(
        streamOf([
          frame("run.error", { id: 2, runId: 7, seq: 2, ts: "", type: "error", message: "Step blew up" }, 2),
          frame("run.status", { id: 3, runId: 7, seq: 3, ts: "", type: "status", message: "failed" }, 3),
          frame("done", { runId: 7 }),
        ]),
      ),
    );

    await page.goto("/agents/1");
    const row = page.getByTestId("task-row").first();
    await row.getByRole("button", { expanded: false }).click();

    const panel = row.getByTestId("run-panel");

    await expect(row.getByTestId("run-log").locator('[data-event-type="error"]')).toContainText(
      "Step blew up",
    );
    await expect(panel.getByTestId("status-badge")).toHaveAttribute("data-status", "failed");
    await expect(panel.getByRole("button", { name: /retry/i })).toBeVisible();
  });
});
