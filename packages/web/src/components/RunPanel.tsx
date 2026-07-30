import { useEffect, useRef, useState } from "react";
import { isTerminalStatus, type TaskWithAgent } from "@trase/core";
import { useRunStream } from "../hooks/useRunStream.js";
import { useCancelRun, useRunTask, useTask } from "../queries.js";
import { StatusBadge } from "./StatusBadge.js";
import { RunHistory } from "./RunHistory.js";

export function RunPanel({ task }: { task: TaskWithAgent }) {
  // POST /run returns the new runId immediately, but `task.latestRunId` only
  // catches up on the next poll. Without holding it locally, the panel keeps
  // rendering the PREVIOUS run's log — with a Retry button — for as long as
  // that round-trip takes, and a second click lands on the live run and gets
  // a 409. Invisible on localhost, obvious on a slow connection.
  const [startedRunId, setStartedRunId] = useState<number | null>(null);
  // Set when the user picks an older attempt out of the history.
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const detail = useTask(task.id);
  const runTask = useRunTask();
  const cancelRun = useCancelRun();
  const logRef = useRef<HTMLOListElement>(null);

  // Once the list catches up, defer to it again, so the panel follows the
  // server rather than a stale local value.
  useEffect(() => {
    if (task.latestRunId !== null && task.latestRunId === startedRunId) {
      setStartedRunId(null);
    }
  }, [task.latestRunId, startedRunId]);

  const latestRunId = startedRunId ?? task.latestRunId;
  const viewingRunId = selectedRunId ?? latestRunId;
  const viewingHistorical = selectedRunId !== null && selectedRunId !== latestRunId;

  const stream = useRunStream(viewingRunId);

  // Keep the newest line in view without yanking the whole page.
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [stream.events.length]);

  // While a freshly started run is still unknown to the list, trust the stream
  // rather than the task row, which still describes the previous attempt.
  const status =
    stream.status ??
    (startedRunId !== null ? "queued" : task.status === "never_run" ? null : task.status);

  // An older run is finished by definition, so never offer Cancel while one is
  // on screen — that button belongs to the live run only.
  const active = !viewingHistorical && status !== null && !isTerminalStatus(status);
  const recoverable = status === "failed" || status === "cancelled";

  const runs = detail.data?.runs ?? [];

  return (
    <div className="space-y-3" data-testid="run-panel">
      <div className="flex flex-wrap items-center gap-2">
        {status ? <StatusBadge status={status} live testId="current-run-status" /> : null}

        {active ? (
          <button
            type="button"
            onClick={() => viewingRunId !== null && cancelRun.mutate(viewingRunId)}
            disabled={cancelRun.isPending}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-slate-600"
          >
            {cancelRun.isPending ? "Cancelling…" : "Cancel"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              runTask.mutate(task.id, {
                onSuccess: ({ runId }) => {
                  setStartedRunId(runId);
                  // Snap back to the live run if an older one was on screen.
                  setSelectedRunId(null);
                },
              })
            }
            disabled={runTask.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            {runTask.isPending ? "Starting…" : recoverable ? "Retry" : "Run"}
          </button>
        )}

        {viewingHistorical ? (
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="text-xs text-slate-500 underline underline-offset-2"
          >
            Back to latest run
          </button>
        ) : null}

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
      ) : viewingRunId === null ? (
        <p className="text-sm text-slate-500">This task has not run yet.</p>
      ) : null}

      <RunHistory runs={runs} selectedRunId={viewingRunId} onSelect={setSelectedRunId} />
    </div>
  );
}
