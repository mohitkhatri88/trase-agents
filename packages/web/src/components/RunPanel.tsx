import { useEffect, useRef } from "react";
import { isTerminalStatus, type TaskWithAgent } from "@trase/core";
import { useRunStream } from "../hooks/useRunStream.js";
import { useCancelRun, useRunTask } from "../queries.js";
import { StatusBadge } from "./StatusBadge.js";

export function RunPanel({ task }: { task: TaskWithAgent }) {
  const stream = useRunStream(task.latestRunId);
  const runTask = useRunTask();
  const cancelRun = useCancelRun();
  const logRef = useRef<HTMLOListElement>(null);

  // Keep the newest line in view without yanking the whole page.
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [stream.events.length]);

  const status = stream.status ?? (task.status === "never_run" ? null : task.status);
  const active = status !== null && !isTerminalStatus(status);
  const recoverable = status === "failed" || status === "cancelled";

  return (
    <div className="space-y-3" data-testid="run-panel">
      <div className="flex flex-wrap items-center gap-2">
        {status ? <StatusBadge status={status} /> : null}

        {active ? (
          <button
            type="button"
            onClick={() => task.latestRunId !== null && cancelRun.mutate(task.latestRunId)}
            disabled={cancelRun.isPending}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-slate-600"
          >
            {cancelRun.isPending ? "Cancelling…" : "Cancel"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => runTask.mutate(task.id)}
            disabled={runTask.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            {runTask.isPending ? "Starting…" : recoverable ? "Retry" : "Run"}
          </button>
        )}

        {active && !stream.connected ? (
          <span className="text-xs text-amber-600">Reconnecting…</span>
        ) : null}
      </div>

      {runTask.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {runTask.error instanceof Error ? runTask.error.message : "Could not start the run"}
        </p>
      ) : null}
      {cancelRun.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {cancelRun.error instanceof Error ? cancelRun.error.message : "Could not cancel the run"}
        </p>
      ) : null}

      {stream.events.length > 0 ? (
        <ol
          ref={logRef}
          aria-label="Run log"
          data-testid="run-log"
          className="max-h-64 space-y-1 overflow-y-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100"
        >
          {stream.events.map((event) => (
            <li
              key={event.seq}
              data-event-type={event.type}
              className={
                event.type === "error"
                  ? "text-red-400"
                  : event.type === "status"
                    ? "text-slate-400"
                    : ""
              }
            >
              {event.message}
            </li>
          ))}
        </ol>
      ) : task.latestRunId === null ? (
        <p className="text-sm text-slate-500">This task has not run yet.</p>
      ) : null}
    </div>
  );
}
