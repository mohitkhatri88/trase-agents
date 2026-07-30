export interface Clock {
  sleep(ms: number): Promise<void>;
  now(): Date;
}

export const realClock: Clock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

/**
 * Advances instantly while recording how much simulated time passed.
 *
 * This is what turns "a run that takes eight seconds" into "a test that takes
 * two milliseconds". Without it, testing the engine would mean really sleeping,
 * which means slow tests, which means tests nobody runs.
 */
export class FakeClock implements Clock {
  private elapsedMs = 0;

  async sleep(ms: number): Promise<void> {
    this.elapsedMs += ms;
  }

  now(): Date {
    return new Date(this.elapsedMs);
  }

  get elapsed(): number {
    return this.elapsedMs;
  }
}

/**
 * A real clock with time compressed by a fixed factor. Used by the end-to-end
 * suite so a full run finishes in a fraction of a second while still exercising
 * the genuine asynchronous path — real timers, real streaming, real ordering.
 */
export function scaledClock(factor: number): Clock {
  return {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms * factor)))),
    now: () => new Date(),
  };
}
