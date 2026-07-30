import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createStore, type Store } from "./index.js";
import {
  cleanupTestDbs,
  createTestDb,
  failingProfile,
  passingProfile,
  seedAgentAndTask,
} from "../test-helpers.js";

let store: Store;

beforeEach(async () => {
  const db = await createTestDb();
  store = createStore(db);
});

afterAll(() => cleanupTestDbs());

describe("agent store", () => {
  it("creates and lists agents alphabetically", async () => {
    await store.agents.create({ name: "Zebra", description: "z", simulationProfile: passingProfile });
    await store.agents.create({ name: "Alpha", description: "a", simulationProfile: passingProfile });

    expect((await store.agents.list()).map((a) => a.name)).toEqual(["Alpha", "Zebra"]);
  });

  it("returns undefined for a missing agent", async () => {
    expect(await store.agents.get(999)).toBeUndefined();
  });

  it("round-trips the simulation profile as JSON", async () => {
    const agent = await store.agents.create({
      name: "A",
      description: "d",
      simulationProfile: failingProfile,
    });
    const profile = await store.agents.getProfile(agent.id);
    expect(profile?.steps[0]?.label).toBe("Doomed step");
    expect(profile?.steps[0]?.failureRate).toBe(1);
  });

  it("counts agents", async () => {
    expect(await store.agents.count()).toBe(0);
    await store.agents.create({ name: "A", description: "d", simulationProfile: passingProfile });
    expect(await store.agents.count()).toBe(1);
  });
});

describe("task store", () => {
  it("reports never_run and a null latestRunId for an unrun task", async () => {
    const { task } = await seedAgentAndTask(store);

    const found = await store.tasks.get(task.id);
    expect(found?.status).toBe("never_run");
    expect(found?.latestRunId).toBeNull();
    expect(found?.agent.name).toBe("Test Agent");
  });

  it("filters tasks by agent", async () => {
    const a1 = await store.agents.create({ name: "A1", description: "d", simulationProfile: passingProfile });
    const a2 = await store.agents.create({ name: "A2", description: "d", simulationProfile: passingProfile });
    await store.tasks.create({ title: "for a1", description: "d", agentId: a1.id });
    await store.tasks.create({ title: "for a2", description: "d", agentId: a2.id });

    expect((await store.tasks.list(a1.id)).map((t) => t.title)).toEqual(["for a1"]);
    expect(await store.tasks.list()).toHaveLength(2);
  });

  it("returns an empty list for an agent with no tasks", async () => {
    const agent = await store.agents.create({ name: "A", description: "d", simulationProfile: passingProfile });
    expect(await store.tasks.list(agent.id)).toEqual([]);
  });

  it("derives status from the most recent run, not the first", async () => {
    const { task } = await seedAgentAndTask(store);

    const first = await store.runs.create(task.id);
    await store.runs.appendEvent(first.id, "status", "failed");
    expect((await store.tasks.get(task.id))?.status).toBe("failed");

    const second = await store.runs.create(task.id);
    await store.runs.appendEvent(second.id, "status", "completed");

    const found = await store.tasks.get(task.id);
    expect(found?.status).toBe("completed");
    expect(found?.latestRunId).toBe(second.id);
  });
});
