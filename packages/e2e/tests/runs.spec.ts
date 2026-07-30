import { test, expect } from "@playwright/test";
import {
  FIXTURES,
  expandTask,
  openAgent,
  runButton,
  runStatus,
  uniqueTitle,
} from "./helpers.js";

/**
 * These run against the real server with the real streaming path. Determinism
 * comes from the fixture agents' simulation profiles — failureRate 0 can never
 * fail and failureRate 1 always fails — not from stubbing anything out.
 */
test.describe("running a task", () => {
  test("streams live progress through to success", async ({ page }) => {
    await openAgent(page, FIXTURES.succeeds.agent);
    const row = await expandTask(page, FIXTURES.succeeds.task);

    await runButton(row).click();

    const log = row.getByTestId("run-log");
    await expect(log).toBeVisible();
    await expect(log).toContainText("queued");
    await expect(log).toContainText("Doing the first thing…");
    await expect(log).toContainText("Doing the second thing — done");

    await expect(runStatus(row)).toHaveAttribute("data-status", "completed");
    await expect(runStatus(row)).toContainText("Succeeded");
  });

  test("shows the failing step and offers a retry", async ({ page }) => {
    await openAgent(page, FIXTURES.fails.agent);
    const row = await expandTask(page, FIXTURES.fails.task);

    await runButton(row).click();

    await expect(runStatus(row)).toHaveAttribute("data-status", "failed");
    await expect(row.getByTestId("run-log")).toContainText("Reticulating splines failed");

    // The first step still succeeded — failure is reported at the right place.
    await expect(row.getByTestId("run-log")).toContainText("Doing the first thing — done");
    await expect(row.getByTestId("run-panel").getByRole("button", { name: /retry/i })).toBeVisible();
  });

  test("retrying creates a second run rather than mutating the first", async ({ page }) => {
    await openAgent(page, FIXTURES.fails.agent);
    const row = await expandTask(page, FIXTURES.fails.task);

    await runButton(row).click();
    await expect(runStatus(row)).toHaveAttribute("data-status", "failed");

    const taskId = await row.getAttribute("data-task-id");
    const before = await (await page.request.get(`/api/tasks/${taskId}`)).json();

    await runButton(row).click();
    await expect(runStatus(row)).toHaveAttribute("data-status", "failed");

    const after = await (await page.request.get(`/api/tasks/${taskId}`)).json();
    expect(after.runs.length).toBe(before.runs.length + 1);
  });

  test("cancels an in-progress run at the next step boundary", async ({ page }) => {
    await openAgent(page, FIXTURES.slow.agent);
    const row = await expandTask(page, FIXTURES.slow.task);

    await runButton(row).click();
    await expect(runStatus(row)).toHaveAttribute("data-status", "running");

    await row.getByTestId("run-panel").getByRole("button", { name: /cancel/i }).click();

    await expect(runStatus(row)).toHaveAttribute("data-status", "cancelled");
    await expect(runStatus(row)).toContainText("Cancelled");
  });

  test("resumes the live log after a mid-run refresh", async ({ page }) => {
    await openAgent(page, FIXTURES.slow.agent);
    const row = await expandTask(page, FIXTURES.slow.task);

    await runButton(row).click();
    await expect(row.getByTestId("run-log")).toContainText("Long step 1…");

    // A hard reload sends no Last-Event-ID, so this only passes because the
    // client supplies ?since= from the REST snapshot.
    await page.reload();
    const reopened = await expandTask(page, FIXTURES.slow.task);

    await expect(reopened.getByTestId("run-log")).toContainText("queued");
    await expect(runStatus(reopened)).toHaveAttribute("data-status", "completed", {
      timeout: 20_000,
    });
  });

  test("run history accumulates across runs", async ({ page }) => {
    const title = uniqueTitle("History check");
    await openAgent(page, FIXTURES.succeeds.agent);

    await page.getByLabel("Task title").fill(title);
    await page.getByLabel("Task description").fill("counts its runs");
    await page.getByRole("button", { name: /create task/i }).click();

    const row = await expandTask(page, title);
    for (let i = 0; i < 2; i++) {
      await runButton(row).click();
      await expect(runStatus(row)).toHaveAttribute("data-status", "completed");
    }

    const taskId = await row.getAttribute("data-task-id");
    const detail = await (await page.request.get(`/api/tasks/${taskId}`)).json();
    expect(detail.runs).toHaveLength(2);
  });
});

test.describe("task creation", () => {
  test("creates a task with the agent picker and shows it in the list", async ({ page }) => {
    const title = uniqueTitle("Created from UI");
    await openAgent(page, FIXTURES.succeeds.agent);

    await page.getByLabel("Task title").fill(title);
    await page.getByLabel("Task description").fill("made by the e2e suite");
    await page.getByLabel("Assign to agent").selectOption({ label: FIXTURES.succeeds.agent });
    await page.getByRole("button", { name: /create task/i }).click();

    const row = page.getByTestId("task-row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("status-badge").first()).toContainText("Never run");
  });

  test("keeps the submit button disabled until the form is complete", async ({ page }) => {
    await openAgent(page, FIXTURES.succeeds.agent);
    const submit = page.getByRole("button", { name: /create task/i });

    await expect(submit).toBeDisabled();
    await page.getByLabel("Task title").fill("only a title");
    await expect(submit).toBeDisabled();
    await page.getByLabel("Task description").fill("now a description");
    await expect(submit).toBeEnabled();
  });
});

test.describe("all tasks view", () => {
  test("shows every task with its assigned agent", async ({ page }) => {
    await page.goto("/tasks");

    const rows = page.getByTestId("task-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);

    // The column the brief asks for: status AND assigned agent.
    await expect(rows.first().getByTestId("task-agent")).toBeVisible();
    await expect(rows.first().getByTestId("status-badge").first()).toBeVisible();
  });

  test("a deep link to /tasks is served by the SPA catch-all", async ({ page }) => {
    // Typed directly rather than navigated to — this is the request that 404s
    // without a catch-all, and it only ever fails once deployed.
    const response = await page.goto("/tasks");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("task-row").first()).toBeVisible();
  });
});

test.describe("stats", () => {
  test("counts increase after a run completes", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByTestId("stats-footer")).toBeVisible();

    const before = Number(await page.getByTestId("stat-succeeded").innerText());

    await openAgent(page, FIXTURES.succeeds.agent);
    const row = await expandTask(page, FIXTURES.succeeds.task);
    await runButton(row).click();
    await expect(runStatus(row)).toHaveAttribute("data-status", "completed");

    await expect
      .poll(async () => Number(await page.getByTestId("stat-succeeded").innerText()))
      .toBeGreaterThan(before);
  });
});
