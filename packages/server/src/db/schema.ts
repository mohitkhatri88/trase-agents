import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { EventType, RunStatus, SimulationProfile } from "@trase/core";

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  simulationProfile: text("simulation_profile", { mode: "json" })
    .$type<SimulationProfile>()
    .notNull(),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("tasks_agent_idx").on(t.agentId)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    status: text("status").$type<RunStatus>().notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    error: text("error"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    // Monotonic per-run event counter, incremented inside a transaction so seq
    // is gapless and ordered. `id` being autoincrement also makes "the most
    // recent run" deterministic without a timestamp tiebreak.
    seqCounter: integer("seq_counter").notNull().default(0),
  },
  (t) => [
    index("runs_task_idx").on(t.taskId, t.id),
    // Enforces "at most one active run per task" in the database rather than
    // by a check-then-act in the handler, which two simultaneous requests can
    // interleave. The insert simply fails, and the handler turns that into 409.
    uniqueIndex("runs_one_active_per_task")
      .on(t.taskId)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    seq: integer("seq").notNull(),
    ts: text("ts").notNull(),
    type: text("type").$type<EventType>().notNull(),
    message: text("message").notNull(),
  },
  (t) => [uniqueIndex("run_events_run_seq_idx").on(t.runId, t.seq)],
);
