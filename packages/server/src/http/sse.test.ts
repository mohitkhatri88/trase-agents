import { describe, it, expect, afterAll, vi } from "vitest";
import { scaledClock } from "@trase/core";
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

  it("prefers Last-Event-ID over a stale ?since= when both are present", async () => {
    const ctx = await finishedRun();
    const all = await ctx.store.runs.eventsAfter(ctx.runId, 0);
    const last = all.at(-1)!.seq;

    // EventSource reconnects to the SAME url, so ?since= is frozen at the
    // cursor from when the stream first opened while the header is current.
    // Preferring the query string would replay the whole log every reconnect.
    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events?since=0`, {
      headers: { "Last-Event-ID": String(last) },
    });

    expect(text).not.toContain("event: run.log");
    expect(text).toContain("event: done");
  });

  it("still honours ?since= when no header is sent, which is the hard-refresh case", async () => {
    const ctx = await finishedRun();
    const all = await ctx.store.runs.eventsAfter(ctx.runId, 0);

    const { text } = await readStream(ctx, `/api/runs/${ctx.runId}/events?since=${all.at(-1)!.seq}`);

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

/**
 * Everything above asserts against an already-terminal run, which is what keeps
 * those tests from hanging. But that means the loop body in runs.ts executes
 * exactly once and breaks — so the parts that only matter while a run is LIVE
 * (the bus wakeup driving the stream, incremental delivery, and closing the
 * subscription on abort) would otherwise have no coverage at all.
 */
describe("streaming a live run", () => {
  it("delivers events incrementally as they happen, not in one batch at the end", async () => {
    const ctx = await makeTestApp({ clock: scaledClock(0.02) });
    const { task } = await seedAgentAndTask(ctx.store, {
      steps: Array.from({ length: 5 }, (_, i) => ({
        label: `Step ${i + 1}`,
        minMs: 400,
        maxMs: 400,
        failureRate: 0,
      })),
    });

    const { runId } = await (await ctx.app.request(`/api/tasks/${task.id}/run`, jsonPost())).json();

    const res = await ctx.app.request(`/api/runs/${runId}/events`, {
      signal: AbortSignal.timeout(10_000),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const chunks: string[] = [];
    while (chunks.length < 40) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    await ctx.runner.settled();

    const body = chunks.join("");

    // More than one chunk is the whole point: a single chunk would mean the
    // response was buffered until the run finished rather than streamed.
    expect(chunks.length).toBeGreaterThan(1);
    expect(body).toContain("Step 1…");
    expect(body).toContain("Step 5 — done");
    expect(body).toContain("event: done");

    // Sequence numbers arrive in order, with no gaps.
    const seqs = [...body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  it("releases its bus subscription when the client goes away", async () => {
    const ctx = await makeTestApp({ clock: scaledClock(0.05) });
    const { task } = await seedAgentAndTask(ctx.store, {
      steps: [{ label: "Long step", minMs: 4000, maxMs: 4000, failureRate: 0 }],
    });
    const { runId } = await (await ctx.app.request(`/api/tasks/${task.id}/run`, jsonPost())).json();

    const controller = new AbortController();
    const res = await ctx.app.request(`/api/runs/${runId}/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();

    expect(ctx.bus.trackedRuns).toBeGreaterThan(0);

    await reader.cancel();
    controller.abort();
    await ctx.runner.settled();

    // Without stream.onAbort closing the subscription, every abandoned stream
    // would leak one — invisible in a demo, fatal over days.
    await vi.waitFor(() => expect(ctx.bus.trackedRuns).toBe(0), { timeout: 5000 });
  });
});
