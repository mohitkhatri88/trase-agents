import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no EventSource, so tests get a controllable stand-in that they
 * drive explicitly. This keeps streaming tests deterministic — no timers, no
 * waiting, no flake.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
    // Mirror the browser: open fires asynchronously, after construction.
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(type: string, fn: (event: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(fn);
  }

  removeEventListener(type: string, fn: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: deliver a named SSE event. */
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  static latest(): MockEventSource {
    const last = MockEventSource.instances.at(-1);
    if (!last) throw new Error("no EventSource was constructed");
    return last;
  }
}

// @ts-expect-error — install the stub over jsdom's missing EventSource.
globalThis.EventSource = MockEventSource;
