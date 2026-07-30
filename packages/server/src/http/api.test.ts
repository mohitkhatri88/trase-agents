import { describe, it, expect, afterAll } from "vitest";
import {
  cleanupTestDbs,
  failingProfile,
  jsonPost,
  makeTestApp,
  passingProfile,
  seedAgentAndTask,
} from "../test-helpers.js";

afterAll(() => cleanupTestDbs());

describe("GET /api/health", () => {
  it("reports ok with build metadata", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.node).toBe("string");
  });

  it("is also served at /health for platform health checks", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/health")).status).toBe(200);
  });
});

describe("agents", () => {
  it("returns an empty array when there are none", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/agents");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("creates an agent and returns 201", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/agents", jsonPost({ name: "Parser", description: "Parses" }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Parser");
    expect(typeof body.id).toBe("number");
  });

  it("rejects a missing name with a machine-readable 400", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/agents", jsonPost({ description: "no name" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_FIELD");
    expect(body.error.details.field).toBe("name");
  });

  it("rejects a blank name", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/agents", jsonPost({ name: "   ", description: "d" }));
    expect(res.status).toBe(400);
  });

  it("returns a single agent by id", async () => {
    const { app, store } = await makeTestApp();
    const { agent } = await seedAgentAndTask(store);

    const body = await (await app.request(`/api/agents/${agent.id}`)).json();
    expect(body.id).toBe(agent.id);
    expect(body.name).toBe("Test Agent");
  });

  it("returns 404 for an unknown agent", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/agents/999");

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_NOT_FOUND");
  });

  it("returns 400 for a non-numeric id", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/api/agents/abc")).status).toBe(400);
  });

  it("lists the tasks belonging to an agent", async () => {
    const { app, store } = await makeTestApp();
    const { agent } = await seedAgentAndTask(store);

    const body = await (await app.request(`/api/agents/${agent.id}/tasks`)).json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("Test task");
  });
});

describe("POST /api/tasks", () => {
  it("returns 400 when the assigned agent does not exist", async () => {
    const { app } = await makeTestApp();
    const res = await app.request(
      "/api/tasks",
      jsonPost({ title: "T", description: "d", agentId: 12345 }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
    expect(body.error.details.field).toBe("agentId");
  });

  it("returns 400 when the title is missing", async () => {
    const { app, store } = await makeTestApp();
    const { agent } = await seedAgentAndTask(store);

    const res = await app.request("/api/tasks", jsonPost({ description: "d", agentId: agent.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_FIELD");
  });

  it("returns 400 when agentId is not an integer", async () => {
    const { app } = await makeTestApp();
    const res = await app.request(
      "/api/tasks",
      jsonPost({ title: "T", description: "d", agentId: "not-a-number" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a task assigned to an existing agent", async () => {
    const { app, store } = await makeTestApp();
    const { agent } = await seedAgentAndTask(store);

    const res = await app.request(
      "/api/tasks",
      jsonPost({ title: "Parse invoices", description: "d", agentId: agent.id }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).title).toBe("Parse invoices");
  });
});

describe("GET /api/tasks", () => {
  it("includes the assigned agent and a derived status", async () => {
    const { app, store } = await makeTestApp();
    await seedAgentAndTask(store);

    const body = await (await app.request("/api/tasks")).json();
    expect(body).toHaveLength(1);
    expect(body[0].agent.name).toBe("Test Agent");
    expect(body[0].status).toBe("never_run");
  });

  it("filters by agent_id", async () => {
    const { app, store } = await makeTestApp();
    const first = await seedAgentAndTask(store);
    const other = await store.agents.create({
      name: "Other",
      description: "d",
      simulationProfile: passingProfile,
    });
    await store.tasks.create({ title: "elsewhere", description: "d", agentId: other.id });

    const body = await (await app.request(`/api/tasks?agent_id=${first.agent.id}`)).json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("Test task");
  });

  it("returns 400 for a non-numeric agent_id", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/api/tasks?agent_id=abc")).status).toBe(400);
  });
});

describe("GET /api/tasks/:id", () => {
  it("includes run history", async () => {
    const { app, store } = await makeTestApp();
    const { task } = await seedAgentAndTask(store);
    await store.runs.create(task.id);

    const body = await (await app.request(`/api/tasks/${task.id}`)).json();
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toHaveLength(1);
    expect(body.agent.name).toBe("Test Agent");
  });

  it("returns 404 for an unknown task", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/api/tasks/999")).status).toBe(404);
  });
});

describe("run lifecycle", () => {
  it("returns 202 with a runId and drives the run to a terminal state", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);

    const res = await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    expect(res.status).toBe(202);

    const { runId } = await res.json();
    expect(typeof runId).toBe("number");

    await runner.settled();
    expect((await store.runs.get(runId))?.status).toBe("completed");
  });

  it("records a failing run and surfaces the error", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, failingProfile);

    await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    await runner.settled();

    const body = await (await app.request(`/api/tasks/${task.id}`)).json();
    expect(body.status).toBe("failed");
    expect(body.runs[0].error).toBe("Doomed step failed");
  });

  it("makes the run appear in the task history afterwards", async () => {
    const { app, runner, store } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);

    await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    await runner.settled();

    const body = await (await app.request(`/api/tasks/${task.id}`)).json();
    expect(body.runs).toHaveLength(1);
    expect(body.status).toBe("completed");
  });

  it("returns 409 when a run is already in progress", async () => {
    const { app, store } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);
    await store.runs.create(task.id);

    const res = await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("RUN_IN_PROGRESS");
  });

  it("allows a retry once the previous run is terminal, as a new run", async () => {
    const { app, runner, store } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);

    await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    await runner.settled();
    const second = await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    expect(second.status).toBe(202);
    await runner.settled();

    const body = await (await app.request(`/api/tasks/${task.id}`)).json();
    expect(body.runs).toHaveLength(2);
  });

  it("returns 404 when running an unknown task", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/api/tasks/999/run", jsonPost())).status).toBe(404);
  });
});

describe("cancellation", () => {
  it("accepts cancel for an active run", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);
    const run = await store.runs.create(task.id);

    const res = await app.request(`/api/runs/${run.id}/cancel`, jsonPost());
    expect(res.status).toBe(202);
    expect(await store.runs.isCancelRequested(run.id)).toBe(true);
    await runner.settled();
  });

  it("returns 409 for a run that already finished", async () => {
    const { app, store } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);
    const run = await store.runs.create(task.id);
    await store.runs.appendEvent(run.id, "status", "completed");

    const res = await app.request(`/api/runs/${run.id}/cancel`, jsonPost());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("RUN_ALREADY_FINISHED");
  });

  it("returns 404 for an unknown run", async () => {
    const { app } = await makeTestApp();
    expect((await app.request("/api/runs/999/cancel", jsonPost())).status).toBe(404);
  });
});

describe("GET /api/stats", () => {
  it("returns zeroes on an empty database", async () => {
    const { app } = await makeTestApp();
    const body = await (await app.request("/api/stats")).json();

    expect(body).toEqual({
      agents: 0,
      tasks: 0,
      runs: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
    });
  });

  it("counts agents, tasks and runs by status", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);
    await runner.startRun(task.id);
    await runner.settled();

    const body = await (await app.request("/api/stats")).json();
    expect(body.agents).toBe(1);
    expect(body.tasks).toBe(1);
    expect(body.runs.completed).toBe(1);
  });
});

describe("unknown API routes", () => {
  it("answer with JSON rather than falling through to the SPA", async () => {
    const { app } = await makeTestApp();
    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("concurrent run starts", () => {
  it("lets exactly one of two simultaneous requests win", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);

    // A check-then-act guard in the handler cannot prevent this: both requests
    // can pass the hasActiveRun check before either inserts. Correctness comes
    // from the partial unique index on runs.
    const responses = await Promise.all([
      app.request(`/api/tasks/${task.id}/run`, jsonPost()),
      app.request(`/api/tasks/${task.id}/run`, jsonPost()),
      app.request(`/api/tasks/${task.id}/run`, jsonPost()),
    ]);
    await runner.settled();

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([202, 409, 409]);
    expect(await store.runs.listForTask(task.id)).toHaveLength(1);
  });

  it("allows a new run once the previous one is terminal", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);

    await app.request(`/api/tasks/${task.id}/run`, jsonPost());
    await runner.settled();
    expect((await app.request(`/api/tasks/${task.id}/run`, jsonPost())).status).toBe(202);
    await runner.settled();

    expect(await store.runs.listForTask(task.id)).toHaveLength(2);
  });

  it("keeps different tasks independent", async () => {
    const { app, store, runner } = await makeTestApp();
    const first = await seedAgentAndTask(store, passingProfile);
    const second = await store.tasks.create({
      title: "Second",
      description: "d",
      agentId: first.agent.id,
    });

    const responses = await Promise.all([
      app.request(`/api/tasks/${first.task.id}/run`, jsonPost()),
      app.request(`/api/tasks/${second.id}/run`, jsonPost()),
    ]);
    await runner.settled();

    expect(responses.map((r) => r.status)).toEqual([202, 202]);
  });

  it("tolerates two simultaneous cancels", async () => {
    const { app, store, runner } = await makeTestApp();
    const { task } = await seedAgentAndTask(store, passingProfile);
    const run = await store.runs.create(task.id);

    const responses = await Promise.all([
      app.request(`/api/runs/${run.id}/cancel`, jsonPost()),
      app.request(`/api/runs/${run.id}/cancel`, jsonPost()),
    ]);
    await runner.settled();

    // Both are accepted — requesting cancellation is idempotent.
    expect(responses.every((r) => r.status === 202)).toBe(true);
    expect(await store.runs.isCancelRequested(run.id)).toBe(true);
  });
});
