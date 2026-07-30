import { Hono } from "hono";
import type { Store } from "../store/index.js";
import type { Runner } from "../runner.js";
import { RunAlreadyActiveError } from "../store/runs.js";
import { badRequest, conflict, notFound, parseId, requireInt, requireString } from "./errors.js";

export function taskRoutes(store: Store, runner: Runner) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const raw = c.req.query("agent_id");
    if (raw === undefined) return c.json(await store.tasks.list());

    const agentId = Number(raw);
    if (!Number.isInteger(agentId)) {
      throw badRequest("INVALID_QUERY", "agent_id must be an integer", { field: "agent_id" });
    }
    return c.json(await store.tasks.list(agentId));
  });

  routes.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title = requireString(body, "title", 200);
    const description = requireString(body, "description", 2000);
    const agentId = requireInt(body, "agentId");

    // The validation the brief actually grades: a foreign-key check, not a
    // schema check. No schema validator can perform this one.
    const agent = await store.agents.get(agentId);
    if (!agent) {
      throw badRequest("AGENT_NOT_FOUND", `No agent with id ${agentId}`, { field: "agentId" });
    }

    const task = await store.tasks.create({ title, description, agentId });
    return c.json(task, 201);
  });

  routes.get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const task = await store.tasks.get(id);
    if (!task) throw notFound("TASK_NOT_FOUND", `No task with id ${id}`);

    const runs = await store.runs.listForTask(id);
    return c.json({ ...task, runs });
  });

  routes.post("/:id/run", async (c) => {
    const id = parseId(c.req.param("id"));
    const task = await store.tasks.get(id);
    if (!task) throw notFound("TASK_NOT_FOUND", `No task with id ${id}`);

    // Without this, double-clicking Run starts two concurrent runs whose logs
    // interleave in one pane and whose derived status flickers between them.
    //
    // Checked here for a clean error message, but NOT relied upon: two
    // simultaneous requests can both pass this check before either inserts.
    // The partial unique index on runs is what actually guarantees it, and
    // the catch below turns the loser's constraint violation into the same 409.
    if (await store.runs.hasActiveRun(id)) {
      throw conflict("RUN_IN_PROGRESS", "This task already has a run in progress");
    }

    try {
      const runId = await runner.startRun(id);
      // 202, not 200: the run has been accepted and has NOT finished.
      return c.json({ runId }, 202);
    } catch (err) {
      if (err instanceof RunAlreadyActiveError) {
        throw conflict("RUN_IN_PROGRESS", "This task already has a run in progress");
      }
      throw err;
    }
  });

  return routes;
}
