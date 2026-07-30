export interface Subscription {
  /** Resolves on the next publish for this run, or when timeoutMs elapses. */
  next(timeoutMs: number): Promise<void>;
  close(): void;
}

type Waker = () => void;

/**
 * A wakeup bus. It carries NO payload — only "something changed for run N".
 * Subscribers respond by re-reading the store.
 *
 * This is deliberate. The obvious design — replay from the database, then
 * subscribe to a bus that carries events — has a race: an event emitted
 * between the read and the subscribe lands in the database after the query
 * snapshot and on the bus before the subscriber exists. It is lost
 * permanently, and the client never notices the gap.
 *
 * Carrying only a wakeup makes that structurally impossible. A missed wakeup
 * costs latency until the next heartbeat, never data. It also means replacing
 * this with Redis later needs no ordering or delivery guarantees at all.
 */
export class InProcessBus {
  private readonly wakers = new Map<number, Set<Waker>>();

  publish(runId: number): void {
    const set = this.wakers.get(runId);
    if (!set) return;
    for (const wake of [...set]) wake();
  }

  subscribe(runId: number): Subscription {
    const bus = this;
    const set = bus.wakers.get(runId) ?? new Set<Waker>();
    bus.wakers.set(runId, set);

    let dirty = false;
    let closed = false;
    let pending: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (!pending) return;
      const resolve = pending;
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve();
    };

    const waker: Waker = () => {
      if (closed) return;
      dirty = true;
      if (pending) {
        dirty = false;
        settle();
      }
    };

    set.add(waker);

    return {
      next(timeoutMs) {
        return new Promise<void>((resolve) => {
          if (closed) return resolve();
          // A publish that landed while nobody was waiting is still honoured,
          // otherwise a wakeup arriving between the query and the next await
          // would cost a full heartbeat of latency.
          if (dirty) {
            dirty = false;
            return resolve();
          }
          pending = resolve;
          timer = setTimeout(settle, timeoutMs);
        });
      },
      close() {
        if (closed) return;
        closed = true;
        set.delete(waker);
        // Release the map entry once nobody is listening, or it grows without
        // bound over the lifetime of the process.
        if (set.size === 0) bus.wakers.delete(runId);
        settle();
      },
    };
  }

  /** Test-only: how many run ids currently have listeners. */
  get trackedRuns(): number {
    return this.wakers.size;
  }
}
