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

describe("time budget", () => {
  const threeSteps: SimulationProfile = {
    steps: [
      { label: "First", minMs: 100, maxMs: 100, failureRate: 0 },
      { label: "Second", minMs: 100, maxMs: 100, failureRate: 0 },
      { label: "Third", minMs: 100, maxMs: 100, failureRate: 0 },
    ],
  };

  const fixedRng: Rng = { float: () => 0.9, intBetween: (min) => min };

  it("completes normally when the run fits inside the budget", async () => {
    const sink = new RecordingSink();
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 10_000 });

    expect(sink.statuses()).toEqual(["running", "completed"]);
  });

  it("has no limit at all when no budget is given", async () => {
    const sink = new RecordingSink();
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng });

    expect(sink.statuses()).toEqual(["running", "completed"]);
  });

  it("fails the run when the budget runs out", async () => {
    const sink = new RecordingSink();
    // Two steps fit in 250ms; the third does not.
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 250 });

    expect(sink.statuses()).toEqual(["running", "failed"]);
    expect(sink.messages()).toContain("First — done");
    expect(sink.messages()).toContain("Second — done");
    expect(sink.messages()).not.toContain("Third — done");
  });

  it("names the step it abandoned and admits the effect is unknown", async () => {
    const sink = new RecordingSink();
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 250 });

    const error = sink.events.find((e) => e.type === "error");
    expect(error?.message).toContain("Third");
    expect(error?.message).toContain("250ms");
    expect(error?.message).toContain("unknown");
  });

  it("stops part way through a step rather than waiting for a boundary", async () => {
    // The point of a timeout: a run whose FIRST step outlives the budget must
    // still stop, or a wedged step hangs forever waiting for a checkpoint that
    // never arrives.
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const oneLongStep: SimulationProfile = {
      steps: [{ label: "Wedged", minMs: 60_000, maxMs: 60_000, failureRate: 0 }],
    };

    await execute(oneLongStep, sink, { clock, rng: fixedRng, timeoutMs: 500 });

    expect(sink.statuses()).toEqual(["running", "failed"]);
    // It waited the budget, not the step's full duration.
    expect(clock.elapsed).toBe(500);
  });

  it("reports the budget in seconds once it is over a second", async () => {
    const sink = new RecordingSink();
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 150 });

    const sink2 = new RecordingSink();
    await execute(threeSteps, sink2, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 2500 });

    expect(sink.events.find((e) => e.type === "error")?.message).toContain("150ms");
    // 2.5s budget still fits all three 100ms steps, so nothing fails there.
    expect(sink2.statuses()).toEqual(["running", "completed"]);
  });

  it("still honours cancellation ahead of the budget", async () => {
    const sink = new RecordingSink();
    sink.cancelFromCheck = 1;
    await execute(threeSteps, sink, { clock: new FakeClock(), rng: fixedRng, timeoutMs: 1 });

    expect(sink.statuses()).toEqual(["running", "cancelled"]);
  });
});
