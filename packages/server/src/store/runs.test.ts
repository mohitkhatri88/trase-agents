import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createStore, type Store } from "./index.js";
import { RunAlreadyActiveError } from "./runs.js";
import { cleanupTestDbs, createTestDb, seedAgentAndTask } from "../test-helpers.js";

let store: Store;
let taskId: number;

beforeEach(async () => {
  const db = await createTestDb();
  store = createStore(db);
  const { task } = await seedAgentAndTask(store);
  taskId = task.id;
});

afterAll(() => cleanupTestDbs());

describe("run store", () => {
  it("creates a run already carrying its queued event at seq 1", async () => {
    const run = await store.runs.create(taskId);

    expect(run.status).toBe("queued");
    const events = await store.runs.eventsAfter(run.id, 0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 1, type: "status", message: "queued" });
  });

  it("assigns strictly increasing seq numbers", async () => {
    const run = await store.runs.create(taskId);
    await store.runs.appendEvent(run.id, "log", "one");
    await store.runs.appendEvent(run.id, "log", "two");
    await store.runs.appendEvent(run.id, "log", "three");

    expect((await store.runs.eventsAfter(run.id, 0)).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it("returns only events past the cursor", async () => {
    const run = await store.runs.create(taskId);
    await store.runs.appendEvent(run.id, "log", "one");
    await store.runs.appendEvent(run.id, "log", "two");

    expect((await store.runs.eventsAfter(run.id, 2)).map((e) => e.message)).toEqual(["two"]);
    expect(await store.runs.eventsAfter(run.id, 99)).toEqual([]);
  });

  it("keeps event sequences independent per run", async () => {
    const a = await store.runs.create(taskId);
    await store.runs.appendEvent(a.id, "log", "a1");
    // A task may only have one ACTIVE run, so finish the first before retrying.
    await store.runs.appendEvent(a.id, "status", "completed");

    const b = await store.runs.create(taskId);
    await store.runs.appendEvent(b.id, "log", "b1");

    expect((await store.runs.eventsAfter(a.id, 0)).map((e) => e.message)).toEqual([
      "queued",
      "a1",
      "completed",
    ]);
    expect((await store.runs.eventsAfter(b.id, 0)).map((e) => e.message)).toEqual(["queued", "b1"]);
  });

  it("updates the run and sets finishedAt only on a terminal status", async () => {
    const run = await store.runs.create(taskId);

    await store.runs.appendEvent(run.id, "status", "running");
    const midway = await store.runs.get(run.id);
    expect(midway?.status).toBe("running");
    expect(midway?.finishedAt).toBeNull();

    await store.runs.appendEvent(run.id, "status", "completed");
    const done = await store.runs.get(run.id);
    expect(done?.status).toBe("completed");
    expect(done?.finishedAt).not.toBeNull();
  });

  it("records an error message on the run", async () => {
    const run = await store.runs.create(taskId);
    await store.runs.appendEvent(run.id, "error", "Step one failed");

    expect((await store.runs.get(run.id))?.error).toBe("Step one failed");
  });

  it("tracks whether a task has an active run", async () => {
    const run = await store.runs.create(taskId);
    expect(await store.runs.hasActiveRun(taskId)).toBe(true);

    await store.runs.appendEvent(run.id, "status", "running");
    expect(await store.runs.hasActiveRun(taskId)).toBe(true);

    await store.runs.appendEvent(run.id, "status", "completed");
    expect(await store.runs.hasActiveRun(taskId)).toBe(false);
  });

  it("accepts cancel while active and refuses once terminal", async () => {
    const run = await store.runs.create(taskId);
    expect(await store.runs.requestCancel(run.id)).toBe(true);
    expect(await store.runs.isCancelRequested(run.id)).toBe(true);

    await store.runs.appendEvent(run.id, "status", "completed");
    expect(await store.runs.requestCancel(run.id)).toBe(false);
  });

  it("lists runs for a task newest first", async () => {
    const first = await store.runs.create(taskId);
    await store.runs.appendEvent(first.id, "status", "completed");
    const second = await store.runs.create(taskId);

    expect((await store.runs.listForTask(taskId)).map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("resolves the simulation profile through task and agent", async () => {
    const run = await store.runs.create(taskId);
    const profile = await store.runs.profileForRun(run.id);
    expect(profile?.steps).toHaveLength(2);
  });

  it("recovers orphans, writing the reason into the event log", async () => {
    const done = await store.runs.create(taskId);
    await store.runs.appendEvent(done.id, "status", "completed");
    const stuck = await store.runs.create(taskId);
    await store.runs.appendEvent(stuck.id, "status", "running");

    expect(await store.runs.recoverOrphans("Interrupted by a restart")).toBe(1);

    expect((await store.runs.get(stuck.id))?.status).toBe("failed");
    expect((await store.runs.get(done.id))?.status).toBe("completed");

    const events = await store.runs.eventsAfter(stuck.id, 0);
    expect(events.at(-1)?.message).toBe("failed");
    expect(events.map((e) => e.message)).toContain("Interrupted by a restart");
  });

  it("counts runs by status", async () => {
    const a = await store.runs.create(taskId);
    await store.runs.appendEvent(a.id, "status", "completed");
    const b = await store.runs.create(taskId);
    await store.runs.appendEvent(b.id, "status", "failed");

    const counts = await store.runs.countsByStatus();
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.queued).toBe(0);
  });
});

describe("one active run per task", () => {
  it("refuses a second active run for the same task", async () => {
    await store.runs.create(taskId);
    await expect(store.runs.create(taskId)).rejects.toThrow(RunAlreadyActiveError);
  });

  it("allows a new run once the previous one is terminal", async () => {
    const first = await store.runs.create(taskId);
    await store.runs.appendEvent(first.id, "status", "completed");

    const second = await store.runs.create(taskId);
    expect(second.id).not.toBe(first.id);
  });

  it("allows an active run per task independently", async () => {
    const otherTask = await store.tasks.create({
      title: "Other",
      description: "d",
      agentId: (await store.agents.list())[0]!.id,
    });

    await store.runs.create(taskId);
    await expect(store.runs.create(otherTask.id)).resolves.toBeDefined();
  });
});
