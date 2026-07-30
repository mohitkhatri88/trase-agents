import { Hono } from "hono";
import type { SimulationProfile } from "@trase/core";
import type { Store } from "../store/index.js";
import { notFound, parseId, requireString } from "./errors.js";

/**
 * Agents created through the API get a generic three-step profile. The seeded
 * agents carry hand-written profiles with distinct personalities, which is what
 * makes every code path reachable by clicking rather than by waiting for luck.
 */
const DEFAULT_PROFILE: SimulationProfile = {
  steps: [
    { label: "Preparing", minMs: 400, maxMs: 900, failureRate: 0.02 },
    { label: "Working", minMs: 1200, maxMs: 2400, failureRate: 0.08 },
    { label: "Finishing", minMs: 300, maxMs: 700, failureRate: 0.02 },
  ],
};

export function agentRoutes(store: Store) {
  const routes = new Hono();

  routes.get("/", async (c) => c.json(await store.agents.list()));

  routes.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = requireString(body, "name", 120);
    const description = requireString(body, "description", 1000);

    const agent = await store.agents.create({
      name,
      description,
      simulationProfile: DEFAULT_PROFILE,
    });
    return c.json(agent, 201);
  });

  routes.get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const agent = await store.agents.get(id);
    if (!agent) throw notFound("AGENT_NOT_FOUND", `No agent with id ${id}`);
    return c.json(agent);
  });

  routes.get("/:id/tasks", async (c) => {
    const id = parseId(c.req.param("id"));
    const agent = await store.agents.get(id);
    if (!agent) throw notFound("AGENT_NOT_FOUND", `No agent with id ${id}`);
    return c.json(await store.tasks.list(id));
  });

  return routes;
}
