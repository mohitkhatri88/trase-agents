import { useEffect, useRef, useState } from "react";
import { isTerminalStatus, type RunEvent, type RunStatus } from "@trase/core";
import { api } from "../api.js";
import { useInvalidateAll } from "../queries.js";

/**
 * The `run.` prefix is required, not cosmetic. A bare `event: error` is
 * delivered to EventSource's own `error` handler, which also fires on
 * connection failure — the two would become indistinguishable.
 */
const STREAM_EVENTS = ["run.status", "run.log", "run.error"] as const;

export interface RunStreamState {
  events: RunEvent[];
  status: RunStatus | null;
  connected: boolean;
  done: boolean;
}

/**
 * Reconciles the REST snapshot with the live stream for a single run.
 *
 * Only ONE of these is ever active — the run the user has expanded. Task-list
 * statuses are polled instead, so the number of open connections stays at one
 * no matter how many runs are executing.
 */
export function useRunStream(runId: number | null): RunStreamState {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const lastSeq = useRef(0);
  const refetching = useRef(false);

  const invalidate = useInvalidateAll();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    setEvents([]);
    setStatus(null);
    setConnected(false);
    setDone(false);
    lastSeq.current = 0;
    refetching.current = false;

    if (runId === null) return;

    let disposed = false;
    let source: EventSource | null = null;

    void (async () => {
      const snapshot = await api.runs.get(runId).catch(() => null);
      if (disposed || !snapshot) return;

      setEvents(snapshot.events);
      setStatus(snapshot.status);
      lastSeq.current = snapshot.events.at(-1)?.seq ?? 0;

      // Nothing left to stream — do not open a connection at all.
      if (isTerminalStatus(snapshot.status)) {
        setDone(true);
        return;
      }

      // `?since=` rather than relying on Last-Event-ID: the browser sends that
      // header only on its OWN automatic reconnect, so a hard refresh mid-run
      // opens a brand-new EventSource with no header and would replay from
      // zero. The cursor from the snapshot is what makes refresh seamless.
      source = new EventSource(`/api/runs/${runId}/events?since=${lastSeq.current}`);
      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);

      const onEvent = (raw: MessageEvent) => {
        const event = JSON.parse(raw.data) as RunEvent;

        // Replay is idempotent: anything at or before the cursor is a repeat.
        if (event.seq <= lastSeq.current) return;

        // A gap means something was missed. Refetch rather than guess, which
        // makes the stream self-healing instead of merely correct.
        //
        // Guarded against re-entry: without the flag, several out-of-order
        // frames each fire their own refetch, and whichever resolves LAST
        // wins — so a slower, older snapshot can overwrite a newer one and
        // drag lastSeq backwards.
        if (event.seq > lastSeq.current + 1) {
          if (refetching.current) return;
          refetching.current = true;
          void api.runs
            .get(runId)
            .then((fresh) => {
              if (disposed) return;
              setEvents(fresh.events);
              setStatus(fresh.status);
              lastSeq.current = fresh.events.at(-1)?.seq ?? 0;
            })
            .catch(() => {
              // The heartbeat re-reads the store anyway, so a failed recovery
              // costs latency rather than correctness.
            })
            .finally(() => {
              refetching.current = false;
            });
          return;
        }

        lastSeq.current = event.seq;
        setEvents((prev) => [...prev, event]);

        if (event.type === "status") {
          setStatus(event.message as RunStatus);
          invalidateRef.current();
        }
      };

      for (const name of STREAM_EVENTS) source.addEventListener(name, onEvent);

      source.addEventListener("done", () => {
        setDone(true);
        setConnected(false);
        // Without closing, EventSource treats the server hanging up as a
        // network failure and reconnects forever — one dangling connection
        // for every finished run.
        source?.close();
        invalidateRef.current();
      });
    })();

    return () => {
      disposed = true;
      source?.close();
    };
  }, [runId]);

  return { events, status, connected, done };
}
