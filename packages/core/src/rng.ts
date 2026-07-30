export interface Rng {
  /** Uniform in [0, 1). */
  float(): number;
  /** Uniform integer in [min, max], inclusive. */
  intBetween(min: number, max: number): number;
}

export const realRng: Rng = {
  float: () => Math.random(),
  intBetween: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
};

/**
 * mulberry32 — small, fast, and well distributed.
 *
 * Seeded, so the same seed always produces the same sequence. That is what
 * makes a system whose entire premise is random failure testable: production
 * gets real randomness, tests get a seed and therefore an exact outcome.
 */
export class SeededRng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  intBetween(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }
}

/** Never fails a step. Used by the end-to-end suite for the success path. */
export const alwaysPassRng: Rng = {
  float: () => 1,
  intBetween: (min) => min,
};

/** Always fails the first step it is asked about. Used for the failure path. */
export const alwaysFailRng: Rng = {
  float: () => 0,
  intBetween: (min) => min,
};
