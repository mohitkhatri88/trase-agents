import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { FakeClock, SeededRng } from "@trase/core";
import { createStore, type Store } from "./store/index.js";
import { InProcessBus } from "./bus.js";
import { createRunner, type Runner } from "./runner.js";
import {
  cleanupTestDbs,
  createTestDb,
  failingProfile,
  passingProfile,
  seedAgentAndTask,
} from "./test-helpers.js";

let store: Store;
let bus: InProcessBus;
let runner: Runner;

beforeEach(async () => {
  const db = await createTestDb();
  store = createStore(db);
  bus = new InProcessBus();
  runner = createRunner({ store, bus, clock: new FakeClock(), rng: new SeededRng(1) });
});

afterAll(() => cleanupTestDbs());

describe("runner", () => {
  it("drives a passing run to completed with the full event sequence", async () => {
    const { task } = await seedAgentAndTask(store, passingProfile);

    const runId = await runner.startRun(task.id);
    await runner.settled();

    expect((await store.runs.get(runId))?.status).toBe("completed");
    expect((await store.runs.eventsAfter(runId, 0)).map((e) => e.message)).toEqual([
      "queued",
      "running",
      "Step one…",
      "Step one — done",
      "Step two…",
      "Step two — done",
      "completed",
    ]);
  });

  it("drives a failing run to failed and records the error", async () => {
    const { task } = await seedAgentAndTask(store, failingProfile);

    const runId = await runner.startRun(task.id);
    await runner.settled();

    const run = await store.runs.get(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("Doomed step failed");
  });

  it("returns before the run finishes", async () => {
    const { task } = await seedAgentAndTask(store, passingProfile);

    const runId = await runner.startRun(task.id);
    // startRun resolves as soon as the row exists — execution is detached.
    expect((await store.runs.get(runId))?.status).toBe("queued");

    await runner.settled();
    expect((await store.runs.get(runId))?.status).toBe("completed");
  });

  it("publishes a wakeup for every persisted event", async () => {
    const { task } = await seedAgentAndTask(store, passingProfile);

    let wakeups = 0;
    const original = bus.publish.bind(bus);
    bus.publish = (id: number) => {
      wakeups += 1;
      original(id);
    };

    const runId = await runner.startRun(task.id);
    await runner.settled();

    const events = await store.runs.eventsAfter(runId, 0);
    // One wakeup at creation, then one per engine-emitted event.
    expect(wakeups).toBe(events.length);
  });

  it("reaches cancelled when cancel is requested before execution advances", async () => {
    const { task } = await seedAgentAndTask(store, passingProfile);

    const runId = await runner.startRun(task.id);
    await store.runs.requestCancel(runId);
    await runner.settled();

    expect((await store.runs.get(runId))?.status).toBe("cancelled");
  });

  it("marks the run failed when execution throws, rather than leaving it running", async () => {
    const { task } = await seedAgentAndTask(store, passingProfile);

    const broken = createRunner({
      store: {
        ...store,
        runs: {
          ...store.runs,
          async profileForRun() {
            throw new Error("boom");
          },
        },
      },
      bus,
      clock: new FakeClock(),
      rng: new SeededRng(1),
    });

    const runId = await broken.startRun(task.id);
    await broken.settled();

    const run = await store.runs.get(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("boom");
  });

  it("runs two tasks concurrently without interleaving their event logs", async () => {
    const first = await seedAgentAndTask(store, passingProfile);
    const secondTask = await store.tasks.create({
      title: "Second",
      description: "d",
      agentId: first.agent.id,
    });

    const [runA, runB] = await Promise.all([
      runner.startRun(first.task.id),
      runner.startRun(secondTask.id),
    ]);
    await runner.settled();

    for (const runId of [runA, runB]) {
      const events = await store.runs.eventsAfter(runId, 0);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(events.every((e) => e.runId === runId)).toBe(true);
    }
  });
});
