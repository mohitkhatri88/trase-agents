import { serve } from "@hono/node-server";
import { alwaysFailRng, alwaysPassRng, realClock, realRng, scaledClock, SeededRng, type Clock, type Rng } from "@trase/core";
import { initDb } from "./db/client.js";
import { createStore } from "./store/index.js";
import { InProcessBus } from "./bus.js";
import { createRunner } from "./runner.js";
import { createApp } from "./http/app.js";
import { seedIfEmpty } from "./seed.js";

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", msg, ...extra }));

/**
 * The clock and RNG are injected, which means the end-to-end suite can ask for
 * a deterministic, time-compressed server without any production code knowing
 * about tests. TRASE_SPEED compresses sleeps; TRASE_OUTCOME forces every run to
 * succeed or fail; TRASE_SEED makes the randomness reproducible.
 */
function resolveEngineDeps(): { clock: Clock; rng: Rng; mode: string } {
  const speed = Number(process.env.TRASE_SPEED ?? "1");
  const clock = Number.isFinite(speed) && speed !== 1 ? scaledClock(speed) : realClock;

  const outcome = process.env.TRASE_OUTCOME;
  if (outcome === "pass") return { clock, rng: alwaysPassRng, mode: "always-pass" };
  if (outcome === "fail") return { clock, rng: alwaysFailRng, mode: "always-fail" };

  const seed = process.env.TRASE_SEED;
  if (seed !== undefined && seed !== "") {
    return { clock, rng: new SeededRng(Number(seed)), mode: `seeded:${seed}` };
  }

  return { clock, rng: realRng, mode: "random" };
}

async function main() {
  const { db } = await initDb();

  const store = createStore(db);
  const bus = new InProcessBus();
  const { clock, rng, mode } = resolveEngineDeps();
  const runner = createRunner({ store, bus, clock, rng });

  if (await seedIfEmpty(store)) log("seeded sample agents and tasks");

  // A restart leaves in-flight runs stuck at `running` forever, because the
  // process advancing them is gone. NOTE: this is exactly the code that
  // becomes wrong with more than one instance.
  const recovered = await store.runs.recoverOrphans("Interrupted by a server restart");
  if (recovered > 0) log("recovered orphaned runs", { recovered });

  const app = createApp({
    store,
    bus,
    runner,
    webDist: process.env.NODE_ENV === "production" ? (process.env.WEB_DIST ?? "packages/web/dist") : undefined,
  });

  const port = Number(process.env.PORT ?? 3000);
  const server = serve({ fetch: app.fetch, port }, () => log("listening", { port, engine: mode }));

  // On deploy the platform sends SIGTERM. Without this, in-flight runs simply
  // vanish and are only explained on the next boot; with it they get an honest
  // entry in their own event log.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down", { signal });
    server.close();
    try {
      await store.runs.recoverOrphans("Interrupted by a server shutdown");
    } catch (err) {
      console.error(
        JSON.stringify({ level: "error", msg: "shutdown recovery failed", err: String(err) }),
      );
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
