import { describe, it, expect, afterAll } from "vitest";
import {
  cleanupTestDbs,
  failingProfile,
  jsonPost,
  makeTestApp,
  passingProfile,
  seedAgentAndTask,
  type TestContext,
} from "../test-helpers.js";

afterAll(() => cleanupTestDbs());

/**
 * Every assertion here runs against an ALREADY-TERMINAL run, so the stream
 * closes deterministically. Asserting against a live run means asserting
 * against a stream that does not end — the fastest way to hang CI.
 */
async function finishedRun(profile = passingProfile): Promise<TestContext & { runId: number }> {
  const ctx = await makeTestApp();
  const { task } = await seedAgentAndTask(ctx.store, profile);

  const res = await ctx.app.request(`/api/tasks/${task.id}/run`, jsonPost());
  const { runId } = await res.json();
  await ctx.runner.settled();

  return { ...ctx, runId };
}

const readStream = async (ctx: TestContext, path: string, init?: RequestInit) => {
  const res = await ctx.app.request(path, { signal: AbortSignal.timeout(5000), ...init });
  return { res, text: await res.text() };
};

describe("GET /api/runs/:id/events", () => {
  it("sets the headers that stop proxies buffering the stream", async () => {
    const ctx = await finishedRun();
    const { res } = await readStream(ctx, `/api/runs/${ctx.runId}/events`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("replays the whole log and closes with a done event", async () => {
    const ctx = await finishedRun();
    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events`);

    expect(text).toContain("queued");
    expect(text).toContain("Step one…");
    expect(text).toContain("completed");
    expect(text).toContain("event: done");
  });

  it("prefixes event names so they cannot collide with EventSource's own error event", async () => {
    const ctx = await finishedRun(failingProfile);
    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events`);

    expect(text).toContain("event: run.status");
    expect(text).toContain("event: run.log");
    expect(text).toContain("event: run.error");
    // A bare `event: error` would be delivered to EventSource.onerror.
    expect(text).not.toMatch(/^event: error$/m);
  });

  it("emits each event with its seq as the SSE id", async () => {
    const ctx = await finishedRun();
    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events`);

    const events = await ctx.store.runs.eventsAfter(ctx.runId, 0);
    for (const event of events) {
      expect(text).toContain(`id: ${event.seq}\n`);
    }
  });

  it("honours ?since= and replays only later events", async () => {
    const ctx = await finishedRun();
    const all = await ctx.store.runs.eventsAfter(ctx.runId, 0);
    const cutoff = all[1]!.seq;

    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events?since=${cutoff}`);

    expect(text).not.toContain(`id: ${all[0]!.seq}\n`);
    expect(text).not.toContain(`id: ${all[1]!.seq}\n`);
    expect(text).toContain(`id: ${all[2]!.seq}\n`);
  });

  it("honours Last-Event-ID when ?since= is absent", async () => {
    const ctx = await finishedRun();
    const all = await ctx.store.runs.eventsAfter(ctx.runId, 0);

    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events`, {
      headers: { "Last-Event-ID": String(all[0]!.seq) },
    });

    expect(text).not.toContain(`id: ${all[0]!.seq}\n`);
    expect(text).toContain(`id: ${all[1]!.seq}\n`);
  });

  it("prefers ?since= over Last-Event-ID when both are present", async () => {
    const ctx = await finishedRun();
    const all = await ctx.store.runs.eventsAfter(ctx.runId, 0);
    const last = all.at(-1)!.seq;

    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events?since=${last}`, {
      headers: { "Last-Event-ID": "0" },
    });

    // since= wins, so only the terminal `done` frame remains.
    expect(text).not.toContain("event: run.log");
    expect(text).toContain("event: done");
  });

  it("treats a nonsense cursor as zero rather than erroring", async () => {
    const ctx = await finishedRun();
    const { res, text } = await readStream(ctx, `/api/runs/${ctx.runId}/events?since=banana`);

    expect(res.status).toBe(200);
    expect(text).toContain("queued");
  });

  it("closes immediately for a run that is already terminal", async () => {
    const ctx = await finishedRun();
    const started = Date.now();
    await readStream(ctx, `/api/runs/${ctx.runId}/events`);

    // If the terminal check ran after the heartbeat wait, this would take 15s.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns 404 for an unknown run", async () => {
    const ctx = await makeTestApp();
    expect((await ctx.app.request("/api/runs/999/events")).status).toBe(404);
  });

  it("streams a cancelled run through to its terminal event", async () => {
    const ctx = await makeTestApp();
    const { task } = await seedAgentAndTask(ctx.store, passingProfile);
    const run = await ctx.store.runs.create(task.id);
    await ctx.store.runs.requestCancel(run.id);
    await ctx.store.runs.appendEvent(run.id, "status", "cancelled");

    const { text } = await readStream(ctx, `/api/runs/${run.id}/events`);
    expect(text).toContain("cancelled");
    expect(text).toContain("event: done");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its full event list", async () => {
    const ctx = await finishedRun();
    const body = await (await ctx.app.request(`/api/runs/${ctx.runId}`)).json();

    expect(body.status).toBe("completed");
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events[0].message).toBe("queued");
    expect(body.events.at(-1).message).toBe("completed");
  });

  it("returns 404 for an unknown run", async () => {
    const ctx = await makeTestApp();
    expect((await ctx.app.request("/api/runs/999")).status).toBe(404);
  });
});
