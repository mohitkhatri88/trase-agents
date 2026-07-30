import { test, expect } from "@playwright/test";
import { FIXTURES, openAgent } from "./helpers.js";

test.describe("agent list and filtering", () => {
  test("redirects the root to the agents view", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole("heading", { name: "Trase Agents" })).toBeVisible();
  });

  test("lists the seeded agents", async ({ page }) => {
    await page.goto("/agents");
    const cards = page.getByTestId("agent-card");
    await expect(cards.first()).toBeVisible();
    // Six demo agents plus three deterministic fixtures. At least, rather than
    // exactly — other tests in this suite create agents of their own.
    expect(await cards.count()).toBeGreaterThanOrEqual(9);
  });

  test("filters by name as the user types", async ({ page }) => {
    await page.goto("/agents");
    await page.getByRole("searchbox", { name: /filter agents/i }).fill("invoice");

    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    await expect(page.getByText("Invoice Parser")).toBeVisible();
  });

  test("filters by description, not only by name", async ({ page }) => {
    await page.goto("/agents");
    await page.getByRole("searchbox", { name: /filter agents/i }).fill("legal");

    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    await expect(page.getByText("Contract Summariser")).toBeVisible();
  });

  test("shows an empty state when nothing matches, and recovers when cleared", async ({ page }) => {
    await page.goto("/agents");
    const box = page.getByRole("searchbox", { name: /filter agents/i });

    await box.fill("zzzzzz");
    await expect(page.getByTestId("agent-card")).toHaveCount(0);
    await expect(page.getByText(/no agents match that filter/i)).toBeVisible();

    await box.fill("");
    expect(await page.getByTestId("agent-card").count()).toBeGreaterThanOrEqual(9);
  });

  test("selecting an agent shows its tasks and updates the URL", async ({ page }) => {
    await openAgent(page, FIXTURES.succeeds.agent);

    await expect(page).toHaveURL(/\/agents\/\d+$/);
    await expect(page.getByTestId("task-row").filter({ hasText: FIXTURES.succeeds.task })).toBeVisible();
  });

  test("a deep link to an agent survives a reload", async ({ page }) => {
    await openAgent(page, FIXTURES.succeeds.agent);
    const url = page.url();

    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId("task-row").filter({ hasText: FIXTURES.succeeds.task })).toBeVisible();
  });

  test("the back button returns to the previous agent", async ({ page }) => {
    await openAgent(page, FIXTURES.succeeds.agent);
    const first = page.url();

    await page.getByTestId("agent-card").filter({ hasText: FIXTURES.fails.agent }).first().click();
    await expect(page).not.toHaveURL(first);

    await page.goBack();
    await expect(page).toHaveURL(first);
  });

  test("shows a prompt before any agent is selected", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByText(/select an agent/i)).toBeVisible();
  });
});

test.describe("creating an agent", () => {
  test("creates one, then uses it end to end for a task and a run", async ({ page }) => {
    const name = `UI Agent ${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/agents");

    await page.getByTestId("new-agent-toggle").click();
    await page.getByLabel("Agent name").fill(name);
    await page.getByLabel("Agent description").fill("created by the end-to-end suite");
    await page.getByRole("radio", { name: /reliable/i }).check();
    await page.getByRole("button", { name: /create agent/i }).click();

    // Appears in the list without a reload.
    const card = page.getByTestId("agent-card").filter({ hasText: name });
    await expect(card).toBeVisible();

    // And is immediately usable: assign a task to it and run that task.
    await card.click();
    await page.getByLabel("Task title").fill("Task on a brand new agent");
    await page.getByLabel("Task description").fill("proves the agent really works");
    await page.getByRole("button", { name: /create task/i }).click();

    const row = page.getByTestId("task-row").filter({ hasText: "Task on a brand new agent" }).first();
    await row.getByRole("button", { expanded: false }).click();
    await row.getByTestId("run-panel").getByRole("button", { name: /^run$/i }).click();

    await expect(row.getByTestId("run-log")).toContainText("Preparing…");
    await expect(row.getByTestId("current-run-status")).toHaveAttribute(
      "data-status",
      "completed",
      { timeout: 20_000 },
    );
  });

  test("is filterable like any other agent", async ({ page }) => {
    const name = `Findable ${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/agents");

    await page.getByTestId("new-agent-toggle").click();
    await page.getByLabel("Agent name").fill(name);
    await page.getByLabel("Agent description").fill("a very distinctive description");
    await page.getByRole("button", { name: /create agent/i }).click();
    await expect(page.getByTestId("agent-card").filter({ hasText: name })).toBeVisible();

    await page.getByRole("searchbox", { name: /filter agents/i }).fill("very distinctive");
    await expect(page.getByTestId("agent-card")).toHaveCount(1);
  });

  test("rejects a blank name without losing the form", async ({ page }) => {
    await page.goto("/agents");
    await page.getByTestId("new-agent-toggle").click();

    // The submit stays disabled rather than letting an invalid request through.
    await expect(page.getByRole("button", { name: /create agent/i })).toBeDisabled();
    await page.getByLabel("Agent description").fill("description only");
    await expect(page.getByRole("button", { name: /create agent/i })).toBeDisabled();
  });
});
