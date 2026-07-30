import { describe, it, expect } from "vitest";
import { InProcessBus } from "./bus.js";

describe("InProcessBus", () => {
  it("wakes a waiter when its run is published", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);

    const waiting = sub.next(5000);
    bus.publish(1);

    await expect(waiting).resolves.toBeUndefined();
    sub.close();
  });

  it("does not lose a publish that lands between waits", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);

    // Published while nobody is awaiting. Without the dirty flag this wakeup
    // would be dropped and the next next() would wait a whole heartbeat.
    bus.publish(1);

    const started = Date.now();
    await sub.next(5000);
    expect(Date.now() - started).toBeLessThan(100);
    sub.close();
  });

  it("consumes the dirty flag, so a second wait still blocks", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);

    bus.publish(1);
    await sub.next(5000);

    const started = Date.now();
    await sub.next(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    sub.close();
  });

  it("resolves on timeout when nothing is published", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);

    const started = Date.now();
    await sub.next(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    sub.close();
  });

  it("ignores publishes for other runs", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);

    bus.publish(2);

    const started = Date.now();
    await sub.next(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    sub.close();
  });

  it("wakes every subscriber for the same run", async () => {
    const bus = new InProcessBus();
    const a = bus.subscribe(1);
    const b = bus.subscribe(1);

    const both = Promise.all([a.next(5000), b.next(5000)]);
    bus.publish(1);

    await expect(both).resolves.toEqual([undefined, undefined]);
    a.close();
    b.close();
  });

  it("resolves immediately once closed", async () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);
    sub.close();

    const started = Date.now();
    await sub.next(5000);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("releases its map entry only after every subscriber closes", async () => {
    const bus = new InProcessBus();
    const a = bus.subscribe(1);
    const b = bus.subscribe(1);
    expect(bus.trackedRuns).toBe(1);

    a.close();
    expect(bus.trackedRuns).toBe(1);

    b.close();
    expect(bus.trackedRuns).toBe(0);
  });

  it("is safe to close twice", () => {
    const bus = new InProcessBus();
    const sub = bus.subscribe(1);
    sub.close();
    expect(() => sub.close()).not.toThrow();
  });
});
