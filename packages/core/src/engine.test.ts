import { describe, it, expect } from "vitest";
import { execute, type RunSink } from "./engine.js";
import { FakeClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { EventType, SimulationProfile } from "./types.js";

/** Returns predetermined rolls, so a test states exactly which step fails. */
class ScriptedRng implements Rng {
  private index = 0;
  constructor(private readonly floats: number[]) {}
  float(): number {
    return this.floats[this.index++] ?? 1;
  }
  intBetween(): number {
    return 0;
  }
}

class RecordingSink implements RunSink {
  events: Array<{ type: EventType; message: string }> = [];
  /** Cancel from the Nth check onwards (0 = cancel immediately). */
  cancelFromCheck: number | null = null;
  private checks = 0;

  async emit(type: EventType, message: string): Promise<void> {
    this.events.push({ type, message });
  }

  async isCancelRequested(): Promise<boolean> {
    const cancelled = this.cancelFromCheck !== null && this.checks >= this.cancelFromCheck;
    this.checks += 1;
    return cancelled;
  }

  messages(): string[] {
    return this.events.map((e) => e.message);
  }

  statuses(): string[] {
    return this.events.filter((e) => e.type === "status").map((e) => e.message);
  }
}

const twoSteps: SimulationProfile = {
  steps: [
    { label: "Fetching document", minMs: 10, maxMs: 10, failureRate: 0.5 },
    { label: "Extracting fields", minMs: 10, maxMs: 10, failureRate: 0.5 },
  ],
};

const deps = (floats: number[]) => ({ clock: new FakeClock(), rng: new ScriptedRng(floats) });

describe("execute", () => {
  it("emits the full happy-path sequence in order", async () => {
    const sink = new RecordingSink();
    await execute(twoSteps, sink, deps([0.9, 0.9]));

    expect(sink.messages()).toEqual([
      "running",
      "Fetching document…",
      "Fetching document — done",
      "Extracting fields…",
      "Extracting fields — done",
      "completed",
    ]);
  });

  it("fails at exactly the step whose roll is under its failure rate", async () => {
    const sink = new RecordingSink();
    await execute(twoSteps, sink, deps([0.9, 0.1]));

    expect(sink.statuses()).toEqual(["running", "failed"]);
    expect(sink.events).toContainEqual({ type: "error", message: "Extracting fields failed" });
    expect(sink.messages()).not.toContain("Extracting fields — done");
  });

  it("fails on the first step when the first roll is under the rate", async () => {
    const sink = new RecordingSink();
    await execute(twoSteps, sink, deps([0.1]));

    expect(sink.statuses()).toEqual(["running", "failed"]);
    expect(sink.messages()).not.toContain("Extracting fields…");
  });

  it("cancels before doing any work when already cancelled", async () => {
    const sink = new RecordingSink();
    sink.cancelFromCheck = 0;

    await execute(twoSteps, sink, deps([0.9, 0.9]));

    expect(sink.messages()).toEqual(["cancelled"]);
  });

  it("cancels between steps, after reporting running", async () => {
    const sink = new RecordingSink();
    // Check 0 is the pre-flight check; check 1 is the guard before step one.
    sink.cancelFromCheck = 1;

    await execute(twoSteps, sink, deps([0.9, 0.9]));

    expect(sink.messages()).toEqual(["running", "cancelled"]);
  });

  it("cancels after the first step completes", async () => {
    const sink = new RecordingSink();
    sink.cancelFromCheck = 2;

    await execute(twoSteps, sink, deps([0.9, 0.9]));

    expect(sink.messages()).toEqual([
      "running",
      "Fetching document…",
      "Fetching document — done",
      "cancelled",
    ]);
  });

  it("emits exactly one terminal status", async () => {
    for (const floats of [[0.9, 0.9], [0.1], [0.9, 0.1]]) {
      const sink = new RecordingSink();
      await execute(twoSteps, sink, deps(floats));
      const terminal = sink.statuses().filter((s) => s !== "running");
      expect(terminal).toHaveLength(1);
    }
  });

  it("advances the clock by the summed step durations", async () => {
    const clock = new FakeClock();
    const rng: Rng = { float: () => 0.9, intBetween: (min) => min };
    await execute(twoSteps, new RecordingSink(), { clock, rng });

    expect(clock.elapsed).toBe(20);
  });

  it("completes immediately for a profile with no steps", async () => {
    const sink = new RecordingSink();
    await execute({ steps: [] }, sink, deps([]));

    expect(sink.messages()).toEqual(["running", "completed"]);
  });
});
