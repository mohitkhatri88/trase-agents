import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock, SeededRng, type Clock, type Rng } from "@trase/core";
import { initDb, type Db } from "./db/client.js";
import { createStore, type Store } from "./store/index.js";
import { InProcessBus } from "./bus.js";
import { createRunner, type Runner } from "./runner.js";
import { createApp } from "./http/app.js";

const tempDirs: string[] = [];

/**
 * A fresh file-backed database per test.
 *
 * NOT `:memory:` — libsql gives each transaction its own connection there, so
 * anything written outside a transaction is invisible inside one and every
 * transactional query fails with "no such table". A temp file behaves exactly
 * like production.
 */
export async function createTestDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), "trase-test-"));
  tempDirs.push(dir);
  const { db } = await initDb(`file:${join(dir, "test.db")}`);
  return db;
}

export function cleanupTestDbs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  store: Store;
  bus: InProcessBus;
  runner: Runner;
  db: Db;
}

/**
 * An app backed by a temp database, a fake clock and a seeded RNG — so a run
 * that would take eight seconds finishes in microseconds, and failures happen
 * exactly when the seed says they do.
 */
export async function makeTestApp(opts: { rng?: Rng; clock?: Clock } = {}): Promise<TestContext> {
  const db = await createTestDb();
  const store = createStore(db);
  const bus = new InProcessBus();
  const runner = createRunner({
    store,
    bus,
    clock: opts.clock ?? new FakeClock(),
    rng: opts.rng ?? new SeededRng(1),
  });
  const app = createApp({ store, bus, runner });

  return { app, store, bus, runner, db };
}

export const jsonPost = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Never fails; sleeps are zero-length under a FakeClock. */
export const passingProfile = {
  steps: [
    { label: "Step one", minMs: 10, maxMs: 10, failureRate: 0 },
    { label: "Step two", minMs: 10, maxMs: 10, failureRate: 0 },
  ],
};

/** Always fails on its first step. */
export const failingProfile = {
  steps: [{ label: "Doomed step", minMs: 10, maxMs: 10, failureRate: 1 }],
};

export async function seedAgentAndTask(store: Store, profile = passingProfile) {
  const agent = await store.agents.create({
    name: "Test Agent",
    description: "for tests",
    simulationProfile: profile,
  });
  const task = await store.tasks.create({
    title: "Test task",
    description: "for tests",
    agentId: agent.id,
  });
  return { agent, task };
}
