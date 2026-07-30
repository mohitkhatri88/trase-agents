import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Stats } from "@trase/core";
import type { Store } from "../store/index.js";
import type { Runner } from "../runner.js";
import type { InProcessBus } from "../bus.js";
import { onError } from "./errors.js";
import { agentRoutes } from "./agents.js";
import { taskRoutes } from "./tasks.js";
import { runRoutes } from "./runs.js";

export interface AppDeps {
  store: Store;
  bus: InProcessBus;
  runner: Runner;
  /** Path to the built web bundle, relative to cwd. Omit in dev — Vite serves it. */
  webDist?: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError(onError);

  const healthBody = () => ({
    status: "ok" as const,
    node: process.version,
    commit: process.env.COMMIT_SHA ?? "dev",
    startedAt: STARTED_AT,
  });

  // Both paths: /api/health for the client, /health for platform health checks
  // (which must never point at a streaming endpoint, or the instance gets
  // killed as unhealthy).
  app.get("/api/health", (c) => c.json(healthBody()));
  app.get("/health", (c) => c.json(healthBody()));

  app.get("/api/stats", async (c) => {
    const [agents, tasks, runs] = await Promise.all([
      deps.store.agents.count(),
      deps.store.tasks.count(),
      deps.store.runs.countsByStatus(),
    ]);
    const body: Stats = { agents, tasks, runs };
    return c.json(body);
  });

  app.route("/api/agents", agentRoutes(deps.store));
  app.route("/api/tasks", taskRoutes(deps.store, deps.runner));
  app.route("/api/runs", runRoutes(deps.store, deps.bus));

  // Anything under /api that reached here does not exist. Answer with JSON
  // rather than falling through to the SPA, so a mistyped API path does not
  // return HTML to a fetch() call.
  app.all("/api/*", (c) =>
    c.json({ error: { code: "NOT_FOUND", message: `No route for ${c.req.path}` } }, 404),
  );

  // Production only. ORDER MATTERS: API routes and hashed assets are matched
  // above; the catch-all is last. Without it, a deep link like /tasks reaches
  // the server with that path and 404s — so a link that works inside the app
  // breaks the moment it is pasted anywhere else.
  if (deps.webDist) {
    const root = deps.webDist;
    app.use("/assets/*", serveStatic({ root }));
    app.get("/favicon.ico", serveStatic({ path: `${root}/favicon.ico` }));
    app.get("*", serveStatic({ path: `${root}/index.html` }));
  }

  return app;
}

const STARTED_AT = new Date().toISOString();
