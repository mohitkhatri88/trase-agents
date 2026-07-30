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

  for (const step of profile.steps) {
    if (await sink.isCancelRequested()) {
      await sink.emit("status", "cancelled");
      return;
    }

    await sink.emit("log", `${step.label}…`);
    await deps.clock.sleep(deps.rng.intBetween(step.minMs, step.maxMs));

    if (deps.rng.float() < step.failureRate) {
      await sink.emit("error", `${step.label} failed`);
      await sink.emit("status", "failed");
      return;
    }

    await sink.emit("log", `${step.label} — done`);
  }

  await sink.emit("status", "completed");
}
