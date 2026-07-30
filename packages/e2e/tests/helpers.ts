import { expect, type Locator, type Page } from "@playwright/test";

/** Fixture agents seeded only when TRASE_E2E=1. Outcomes come from the
 *  simulation profile, never from randomness. */
export const FIXTURES = {
  succeeds: { agent: "Always Succeeds", task: "E2E success task" },
  fails: { agent: "Always Fails", task: "E2E failure task" },
  slow: { agent: "Slow And Steady", task: "E2E cancellable task" },
} as const;

/** Creates a task through the API so a UI test can start from a known state. */
export async function createTaskViaApi(
  page: Page,
  input: { title: string; description: string; agentName: string },
): Promise<number> {
  const agents = await (await page.request.get("/api/agents")).json();
  const agent = agents.find((a: { name: string }) => a.name === input.agentName);
  if (!agent) throw new Error(`no seeded agent named ${input.agentName}`);

  const res = await page.request.post("/api/tasks", {
    data: { title: input.title, description: input.description, agentId: agent.id },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

/** Opens an agent by name and returns once its task pane has rendered. */
export async function openAgent(page: Page, name: string) {
  await page.goto("/agents");
  await page.getByTestId("agent-card").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("new-task-form")).toBeVisible();
}

/** Expands a task row so its run panel is visible. */
export async function expandTask(page: Page, title: string) {
  const row = page.getByTestId("task-row").filter({ hasText: title }).first();
  await row.getByRole("button", { expanded: false }).click();
  await expect(row.getByTestId("run-panel")).toBeVisible();
  return row;
}

/**
 * An expanded row contains two status badges — the task's own, in the header,
 * and the run's, inside the panel. They agree, but a bare getByTestId matches
 * both, so every assertion says which one it means.
 */
export const runStatus = (row: Locator) =>
  row.getByTestId("run-panel").getByTestId("status-badge");

export const taskStatus = (row: Locator) =>
  row.getByTestId("status-badge").first();

/** The Run / Retry button inside a row's run panel. */
export const runButton = (row: Locator) =>
  row.getByTestId("run-panel").getByRole("button", { name: /^(run|retry)$/i });

/** A unique title, so reruns of the suite never collide in a shared database. */
export const uniqueTitle = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
