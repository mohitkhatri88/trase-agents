import type { Clock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { EventType, SimulationProfile } from "./types.js";

export interface RunSink {
  emit(type: EventType, message: string): Promise<void>;
  isCancelRequested(): Promise<boolean>;
}

export interface EngineDeps {
  clock: Clock;
  rng: Rng;
  /**
   * Wall-clock budget for the whole run. Omit for no limit.
   *
   * This is the automated stop button, and unlike cancellation it is allowed to
   * fire *mid-step* — see the note in `execute`.
   */
  timeoutMs?: number;
}

/** Formats a duration the way a human reading a log wants to see it. */
function humanMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Walks an agent's simulation profile, emitting progress events as it goes.
 *
 * Every source of nondeterminism is injected. `clock` controls the passage of
 * time and `rng` decides whether a step fails; in production both are real, in
 * tests both are fakes. That is the whole reason this module has no imports
 * from HTTP or the database — it can be exercised exhaustively in milliseconds.
 *
 * Cancellation is checked BETWEEN steps. Work already in flight cannot be
 * interrupted, only asked to stop and allowed to notice at the next checkpoint.
 * That is not a shortcut; it is how every well-behaved worker operates.
 */
export async function execute(
  profile: SimulationProfile,
  sink: RunSink,
  deps: EngineDeps,
): Promise<void> {
  if (await sink.isCancelRequested()) {
    await sink.emit("status", "cancelled");
    return;
  }

  await sink.emit("status", "running");

  const startedAt = deps.clock.now().getTime();
  const budget = deps.timeoutMs;
  const remaining = () =>
    budget === undefined ? Infinity : budget - (deps.clock.now().getTime() - startedAt);

  for (const step of profile.steps) {
    if (await sink.isCancelRequested()) {
      await sink.emit("status", "cancelled");
      return;
    }

    await sink.emit("log", `${step.label}…`);

    const duration = deps.rng.intBetween(step.minMs, step.maxMs);
    const left = remaining();

    // The timeout is deliberately allowed to fire PART WAY THROUGH a step, and
    // that is the whole point of it. Cancellation waits for a safe boundary
    // because the caller changed their mind and can afford to wait. A timeout
    // fires precisely when the run may never reach another boundary — a step
    // wedged on a socket that will never answer. Waiting politely for a
    // checkpoint that is never coming is how a run hangs forever.
    //
    // The cost is real and is recorded honestly: the abandoned step's effect is
    // unknown. That is the trade a timeout always makes.
    if (duration > left) {
      await deps.clock.sleep(Math.max(0, left));
      await sink.emit(
        "error",
        `Exceeded the ${humanMs(budget as number)} time budget during "${step.label}" — abandoned, and this step's effect is unknown`,
      );
      await sink.emit("status", "failed");
      return;
    }

    await deps.clock.sleep(duration);

    if (deps.rng.float() < step.failureRate) {
      await sink.emit("error", `${step.label} failed`);
      await sink.emit("status", "failed");
      return;
    }

    await sink.emit("log", `${step.label} — done`);
  }

  await sink.emit("status", "completed");
}
