import { describe, it, expect } from "vitest";
import { SeededRng } from "./rng.js";
import { FakeClock, scaledClock } from "./clock.js";

describe("SeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    expect([a.float(), a.float(), a.float()]).toEqual([b.float(), b.float(), b.float()]);
  });

  it("produces different sequences for different seeds", () => {
    expect(new SeededRng(1).float()).not.toEqual(new SeededRng(2).float());
  });

  it("returns floats in [0, 1)", () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers inside the inclusive range", () => {
    const rng = new SeededRng(9);
    for (let i = 0; i < 500; i++) {
      const value = rng.intBetween(5, 8);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(8);
    }
  });

  it("handles a single-value range", () => {
    const rng = new SeededRng(3);
    expect(rng.intBetween(4, 4)).toBe(4);
  });
});

describe("FakeClock", () => {
  it("resolves instantly and accumulates elapsed time", async () => {
    const clock = new FakeClock();
    const started = Date.now();
    await clock.sleep(5000);
    await clock.sleep(3000);

    expect(clock.elapsed).toBe(8000);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("scaledClock", () => {
  it("compresses real sleeps by the given factor", async () => {
    const clock = scaledClock(0.001);
    const started = Date.now();
    await clock.sleep(2000);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
