import { Hono } from "hono";
import { AGENT_BEHAVIOURS, isAgentBehaviour, type AgentBehaviour, type SimulationProfile } from "@trase/core";
import type { Store } from "../store/index.js";
import { badRequest, notFound, parseId, requireString } from "./errors.js";

/**
 * The profile behind each behaviour a client can ask for.
 *
 * The client picks a character; the server owns the numbers. An agent whose
 * runs all felt identical would make the create feature hollow — you could
 * make one but never tell it apart from any other.
 */
const BEHAVIOUR_PROFILES: Record<AgentBehaviour, SimulationProfile> = {
  reliable: {
    steps: [
      { label: "Preparing", minMs: 400, maxMs: 900, failureRate: 0.01 },
      { label: "Working", minMs: 900, maxMs: 1800, failureRate: 0.02 },
      { label: "Finishing", minMs: 300, maxMs: 700, failureRate: 0.01 },
    ],
  },
  flaky: {
    steps: [
      { label: "Preparing", minMs: 300, maxMs: 700, failureRate: 0.05 },
      { label: "Working", minMs: 800, maxMs: 1600, failureRate: 0.3 },
      { label: "Finishing", minMs: 300, maxMs: 700, failureRate: 0.1 },
    ],
  },
  slow: {
    steps: [
      { label: "Preparing", minMs: 1500, maxMs: 2500, failureRate: 0.01 },
      { label: "Working", minMs: 2500, maxMs: 4000, failureRate: 0.03 },
      { label: "Verifying", minMs: 1500, maxMs: 2500, failureRate: 0.02 },
      { label: "Finishing", minMs: 800, maxMs: 1400, failureRate: 0.01 },
    ],
  },
};

export function agentRoutes(store: Store) {
  const routes = new Hono();

  routes.get("/", async (c) => c.json(await store.agents.list()));

  routes.post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = requireString(body, "name", 120);
    const description = requireString(body, "description", 1000);

    // Optional, so the endpoint stays backward compatible with a bare
    // { name, description } post.
    const raw = body.behaviour;
    if (raw !== undefined && !isAgentBehaviour(raw)) {
      throw badRequest("INVALID_FIELD", `behaviour must be one of: ${AGENT_BEHAVIOURS.join(", ")}`, {
        field: "behaviour",
      });
    }
    const behaviour: AgentBehaviour = raw ?? "reliable";

    const agent = await store.agents.create({
      name,
      description,
      simulationProfile: BEHAVIOUR_PROFILES[behaviour],
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
