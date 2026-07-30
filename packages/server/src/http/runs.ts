import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isTerminalStatus } from "@trase/core";
import type { Store } from "../store/index.js";
import type { InProcessBus } from "../bus.js";
import { conflict, notFound, parseId } from "./errors.js";

const HEARTBEAT_MS = 15_000;

export function runRoutes(store: Store, bus: InProcessBus) {
  const routes = new Hono();

  routes.get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const run = await store.runs.get(id);
    if (!run) throw notFound("RUN_NOT_FOUND", `No run with id ${id}`);

    const events = await store.runs.eventsAfter(id, 0);
    return c.json({ ...run, events });
  });

  routes.post("/:id/cancel", async (c) => {
    const id = parseId(c.req.param("id"));
    const run = await store.runs.get(id);
    if (!run) throw notFound("RUN_NOT_FOUND", `No run with id ${id}`);

    const accepted = await store.runs.requestCancel(id);
    if (!accepted) throw conflict("RUN_ALREADY_FINISHED", "This run has already finished");

    bus.publish(id);
    return c.json({ cancelled: true }, 202);
  });

  routes.get("/:id/events", async (c) => {
    const id = parseId(c.req.param("id"));
    const run = await store.runs.get(id);
    if (!run) throw notFound("RUN_NOT_FOUND", `No run with id ${id}`);

    // `?since=` takes precedence over Last-Event-ID, because the browser only
    // sends that header on its OWN automatic reconnect. A user hard-refreshing
    // mid-run opens a brand-new EventSource with no header at all, so the
    // client passes the cursor it already knows from the REST snapshot.
    const sinceParam = c.req.query("since");
    const headerParam = c.req.header("Last-Event-ID");
    const parsed = Number(sinceParam ?? headerParam ?? 0);
    let lastSent = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;

    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    // Proxy response buffering is the classic "works locally, dead once
    // deployed" failure for SSE.
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      // Subscribe BEFORE the first read, so a wakeup during the query is not
      // lost. Combined with the payload-free bus, that makes event loss
      // structurally impossible rather than merely unlikely.
      const subscription = bus.subscribe(id);
      // Without this, every abandoned stream leaks a subscription — invisible
      // in a demo, fatal over days.
      stream.onAbort(() => subscription.close());

      try {
        while (!stream.aborted) {
          for (const event of await store.runs.eventsAfter(id, lastSent)) {
            await stream.writeSSE({
              id: String(event.seq),
              // The `run.` prefix is required, not cosmetic: a bare
              // `event: error` is delivered to EventSource's own error
              // handler, which also fires on connection failure, making the
              // two indistinguishable on the client.
              event: `run.${event.type}`,
              data: JSON.stringify(event),
            });
            lastSent = event.seq;
          }

          const current = await store.runs.get(id);
          if (!current || isTerminalStatus(current.status)) {
            // An explicit terminal event, then close. If the server simply
            // hangs up, EventSource treats it as a network failure and
            // reconnects forever — one dangling connection per finished run.
            await stream.writeSSE({ event: "done", data: JSON.stringify({ runId: id }) });
            break;
          }

          // Doubles as a heartbeat and as a self-heal: even if a wakeup were
          // missed entirely, the next tick re-queries.
          await subscription.next(HEARTBEAT_MS);
        }
      } finally {
        subscription.close();
      }
    });
  });

  return routes;
}
