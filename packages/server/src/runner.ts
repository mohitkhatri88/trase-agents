import { execute, type Clock, type Rng, type RunSink } from "@trase/core";
import type { Store } from "./store/index.js";
import type { InProcessBus } from "./bus.js";

export interface Runner {
  /** Creates the run, starts execution in the background, returns immediately. */
  startRun(taskId: number): Promise<number>;
  /** Test-only: awaits every in-flight background run. Never called in production. */
  settled(): Promise<void>;
}

export interface RunnerDeps {
  store: Store;
  bus: InProcessBus;
  clock: Clock;
  rng: Rng;
}

export function createRunner(deps: RunnerDeps): Runner {
  const inFlight = new Set<Promise<void>>();

  async function executeRun(runId: number): Promise<void> {
    const profile = await deps.store.runs.profileForRun(runId);
    if (!profile) throw new Error(`no simulation profile for run ${runId}`);

    const sink: RunSink = {
      async emit(type, message) {
        // Persist FIRST, then wake. Publishing before the write would let a
        // subscriber be told about an event it cannot yet read.
        await deps.store.runs.appendEvent(runId, type, message);
        deps.bus.publish(runId);
      },
      async isCancelRequested() {
        return deps.store.runs.isCancelRequested(runId);
      },
    };

    await execute(profile, sink, { clock: deps.clock, rng: deps.rng });
  }

  return {
    async startRun(taskId) {
      const run = await deps.store.runs.create(taskId);
      deps.bus.publish(run.id);

      const task: Promise<void> = executeRun(run.id)
        .catch(async (err: unknown) => {
          // Without this, an unhandled rejection leaves the run at `running`
          // forever, recoverable only on the next restart.
          const message = err instanceof Error ? err.message : String(err);
          await deps.store.runs.appendEvent(run.id, "error", `Internal error: ${message}`);
          await deps.store.runs.appendEvent(run.id, "status", "failed");
          deps.bus.publish(run.id);
        })
        .finally(() => {
          inFlight.delete(task);
        });

      inFlight.add(task);
      return run.id;
    },

    async settled() {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    },
  };
}
