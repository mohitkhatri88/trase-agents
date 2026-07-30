import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
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
const DEFAULT_RUN_TIMEOUT_MS = 60_000;

/**
 * A run that outlives this is abandoned and marked failed.
 *
 * The automated stop button: it matters most when nobody is watching, which is
 * exactly when a wedged run would otherwise sit at `running` forever. Set
 * TRASE_RUN_TIMEOUT_MS=2000 to watch it fire against the slower seeded agents.
 */
function resolveRunTimeout(): number | undefined {
  const raw = process.env.TRASE_RUN_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_RUN_TIMEOUT_MS;
  if (raw === "0" || raw.toLowerCase() === "off") return undefined;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RUN_TIMEOUT_MS;
}

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

const webDist = process.env.WEB_DIST ?? "packages/web/dist";

async function main() {
  const { db } = await initDb();

  const store = createStore(db);
  const bus = new InProcessBus();
  const { clock, rng, mode } = resolveEngineDeps();
  const timeoutMs = resolveRunTimeout();
  const runner = createRunner({ store, bus, clock, rng, timeoutMs });

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
    // Serve the built UI whenever it exists, rather than keying off NODE_ENV.
    // `NODE_ENV=x cmd` is POSIX-only and would break `pnpm start` on Windows,
    // and in dev this is harmless anyway: the browser talks to Vite on 5173,
    // so nothing ever requests HTML from this port.
    webDist: existsSync(webDist) ? webDist : undefined,
  });

  const port = Number(process.env.PORT ?? 3000);
  const server = serve({ fetch: app.fetch, port }, () => log("listening", { port, engine: mode, runTimeoutMs: timeoutMs ?? "off" }));

  // Port 3000 is the most commonly occupied port on a developer machine, and a
  // raw EADDRINUSE stack trace is a poor first impression for a project whose
  // pitch is one-command setup.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nPort ${port} is already in use.\n` +
          `Free it, or start on another port:  PORT=3001 pnpm dev\n`,
      );
      process.exit(1);
    }
    throw err;
  });

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
