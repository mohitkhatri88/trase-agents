import { eq, desc, asc, sql, inArray } from "drizzle-orm";
import type { RunStatus, Task, TaskWithAgent } from "@trase/core";
import type { Db } from "../db/client.js";
import { agents, runs, tasks } from "../db/schema.js";

export interface TaskStore {
  list(agentId?: number): Promise<TaskWithAgent[]>;
  get(id: number): Promise<TaskWithAgent | undefined>;
  create(input: { title: string; description: string; agentId: number }): Promise<Task>;
  count(): Promise<number>;
}

interface TaskRow {
  id: number;
  title: string;
  description: string;
  agentId: number;
  createdAt: string;
  agentName: string;
}

/**
 * A task deliberately has no status column. Its status is derived from its most
 * recent run — ordered by `id` DESC, which is a monotonic autoincrement, so two
 * runs created in the same millisecond still have a deterministic winner.
 *
 * A denormalised column would create two places that can disagree, and that
 * disagreement is always discovered by a user rather than by a test.
 */
export function createTaskStore(db: Db): TaskStore {
  const selection = {
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    agentId: tasks.agentId,
    createdAt: tasks.createdAt,
    agentName: agents.name,
  };

  /** One query for every task's latest run, rather than one per task. */
  async function latestRuns(taskIds: number[]) {
    const latest = new Map<number, { id: number; status: RunStatus }>();
    if (taskIds.length === 0) return latest;

    const rows = await db
      .select({ id: runs.id, taskId: runs.taskId, status: runs.status })
      .from(runs)
      .where(inArray(runs.taskId, taskIds))
      .orderBy(desc(runs.id));

    for (const row of rows) {
      if (!latest.has(row.taskId)) latest.set(row.taskId, { id: row.id, status: row.status });
    }
    return latest;
  }

  async function decorate(rows: TaskRow[]): Promise<TaskWithAgent[]> {
    const latest = await latestRuns(rows.map((r) => r.id));
    return rows.map((row) => {
      const run = latest.get(row.id);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        agentId: row.agentId,
        createdAt: row.createdAt,
        agent: { id: row.agentId, name: row.agentName },
        status: run?.status ?? "never_run",
        latestRunId: run?.id ?? null,
      };
    });
  }

  return {
    async list(agentId) {
      const base = db.select(selection).from(tasks).innerJoin(agents, eq(tasks.agentId, agents.id));
      const rows =
        agentId === undefined
          ? await base.orderBy(asc(tasks.id))
          : await base.where(eq(tasks.agentId, agentId)).orderBy(asc(tasks.id));
      return decorate(rows);
    },

    async get(id) {
      const rows = await db
        .select(selection)
        .from(tasks)
        .innerJoin(agents, eq(tasks.agentId, agents.id))
        .where(eq(tasks.id, id))
        .limit(1);
      const [decorated] = await decorate(rows);
      return decorated;
    },

    async create(input) {
      const [row] = await db
        .insert(tasks)
        .values({ ...input, createdAt: new Date().toISOString() })
        .returning();
      if (!row) throw new Error("failed to insert task");
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        agentId: row.agentId,
        createdAt: row.createdAt,
      };
    },

    async count() {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(tasks);
      return Number(row?.n ?? 0);
    },
  };
}
