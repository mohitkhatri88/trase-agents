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
    // Six demo agents plus three deterministic fixtures.
    await expect(cards).toHaveCount(9);
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
    await expect(page.getByTestId("agent-card")).toHaveCount(9);
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
