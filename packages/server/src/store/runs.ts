import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  isTerminalStatus,
  type EventType,
  type Run,
  type RunEvent,
  type RunStatus,
  type SimulationProfile,
} from "@trase/core";
import type { Db } from "../db/client.js";
import { agents, runEvents, runs, tasks } from "../db/schema.js";

const ACTIVE: RunStatus[] = ["queued", "running"];

/** Thrown when the one-active-run-per-task index rejects an insert. */
export class RunAlreadyActiveError extends Error {
  constructor(public readonly taskId: number) {
    super(`task ${taskId} already has an active run`);
    this.name = "RunAlreadyActiveError";
  }
}

/** Recognises a SQLite/libsql unique-constraint failure across driver layers. */
function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    parts.push(current.message, String((current as { code?: string }).code ?? ""));
    current = (current as { cause?: unknown }).cause;
  }
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(parts.join(" "));
}

export interface RunStore {
  create(taskId: number): Promise<Run>;
  appendEvent(runId: number, type: EventType, message: string): Promise<{ seq: number; ts: string }>;
  get(runId: number): Promise<Run | undefined>;
  eventsAfter(runId: number, afterSeq: number): Promise<RunEvent[]>;
  listForTask(taskId: number): Promise<Run[]>;
  isCancelRequested(runId: number): Promise<boolean>;
  requestCancel(runId: number): Promise<boolean>;
  hasActiveRun(taskId: number): Promise<boolean>;
  profileForRun(runId: number): Promise<SimulationProfile | undefined>;
  recoverOrphans(reason: string): Promise<number>;
  countsByStatus(): Promise<Record<RunStatus, number>>;
}

const toRun = (row: typeof runs.$inferSelect): Run => ({
  id: row.id,
  taskId: row.taskId,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  error: row.error,
  cancelRequested: row.cancelRequested,
});

export function createRunStore(db: Db): RunStore {
  const self: RunStore = {
    /**
     * The run row and its first event are written together.
     *
     * The brief names `queued` in the event sequence, and a row is not an
     * event — without this, a client attaching to the stream would never see
     * it. It also guarantees at least one event exists before any client can
     * connect, which removes an empty-replay edge case.
     */
    async create(taskId) {
      const ts = new Date().toISOString();

      let row: typeof runs.$inferSelect | undefined;
      try {
        [row] = await db
          .insert(runs)
          .values({ taskId, status: "queued", startedAt: ts, seqCounter: 1 })
          .returning();
      } catch (err) {
        // A partial unique index enforces one active run per task, so two
        // simultaneous requests cannot both succeed. The loser lands here.
        if (isUniqueViolation(err)) throw new RunAlreadyActiveError(taskId);
        throw err;
      }
      if (!row) throw new Error("failed to insert run");

      await db.insert(runEvents).values({
        runId: row.id,
        seq: 1,
        ts,
        type: "status",
        message: "queued",
      });
      return toRun(row);
    },

    async appendEvent(runId, type, message) {
      // Deliberately NOT wrapped in db.transaction().
      //
      // libsql opens a SEPARATE connection for every transaction, so two runs
      // executing concurrently deadlock against each other with SQLITE_BUSY —
      // and an in-memory database can't see its own tables inside one at all.
      //
      // The transaction was never buying anything here. `UPDATE … RETURNING`
      // is atomic on its own, and only one writer ever advances a given run,
      // so the sequence stays gapless and ordered. Statements outside a
      // transaction all share the single client connection, which serialises
      // them for free.
      //
      // The residual risk is a crash between the counter bump and the insert,
      // which would skip a seq. The client treats a gap as "refetch", so the
      // worst case is one redundant request.
      const [counter] = await db
        .update(runs)
        .set({ seqCounter: sql`${runs.seqCounter} + 1` })
        .where(eq(runs.id, runId))
        .returning({ seq: runs.seqCounter });

      if (!counter) throw new Error(`run ${runId} not found`);

      const seq = counter.seq;
      const ts = new Date().toISOString();
      await db.insert(runEvents).values({ runId, seq, ts, type, message });

      if (type === "status") {
        const status = message as RunStatus;
        await db
          .update(runs)
          .set({ status, finishedAt: isTerminalStatus(status) ? ts : null })
          .where(eq(runs.id, runId));
      } else if (type === "error") {
        await db.update(runs).set({ error: message }).where(eq(runs.id, runId));
      }

      return { seq, ts };
    },

    async get(runId) {
      const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      return row ? toRun(row) : undefined;
    },

    async eventsAfter(runId, afterSeq) {
      return db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
        .orderBy(asc(runEvents.seq));
    },

    async listForTask(taskId) {
      const rows = await db.select().from(runs).where(eq(runs.taskId, taskId)).orderBy(desc(runs.id));
      return rows.map(toRun);
    },

    async isCancelRequested(runId) {
      const [row] = await db
        .select({ flag: runs.cancelRequested })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      return row?.flag ?? false;
    },

    async requestCancel(runId) {
      const updated = await db
        .update(runs)
        .set({ cancelRequested: true })
        .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE)))
        .returning({ id: runs.id });
      return updated.length > 0;
    },

    async hasActiveRun(taskId) {
      const rows = await db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.taskId, taskId), inArray(runs.status, ACTIVE)))
        .limit(1);
      return rows.length > 0;
    },

    async profileForRun(runId) {
      const [row] = await db
        .select({ profile: agents.simulationProfile })
        .from(runs)
        .innerJoin(tasks, eq(runs.taskId, tasks.id))
        .innerJoin(agents, eq(tasks.agentId, agents.id))
        .where(eq(runs.id, runId))
        .limit(1);
      return row?.profile;
    },

    /**
     * A restart leaves in-flight runs stuck at `running` forever, because the
     * process that was advancing them is gone. The recovery is written to the
     * event log, not just the row, so a client watching the stream sees why.
     *
     * NOTE: this is precisely the code that becomes WRONG under horizontal
     * scaling — a second instance would mark the first instance's live runs as
     * failed. Going past one instance needs leases, not just a store swap.
     */
    async recoverOrphans(reason) {
      const orphans = await db.select({ id: runs.id }).from(runs).where(inArray(runs.status, ACTIVE));

      for (const { id } of orphans) {
        await self.appendEvent(id, "error", reason);
        await self.appendEvent(id, "status", "failed");
      }
      return orphans.length;
    },

    async countsByStatus() {
      const rows = await db
        .select({ status: runs.status, n: sql<number>`count(*)` })
        .from(runs)
        .groupBy(runs.status);

      const counts: Record<RunStatus, number> = {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };
      for (const row of rows) counts[row.status] = Number(row.n);
      return counts;
    },
  };

  return self;
}
