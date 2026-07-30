import type { Run } from "@trase/core";
import { StatusBadge } from "./StatusBadge.js";

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(run: Run): string | null {
  if (!run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Every attempt, newest first.
 *
 * This is what makes the central design decision visible: a retry is a new row
 * rather than a mutation of the old one, so nothing is ever overwritten and the
 * whole history stays inspectable. Selecting an older run replays its log from
 * the store — no stream is opened, because a finished run has nothing left to
 * say.
 */
export function RunHistory({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId: number | null;
  onSelect: (runId: number) => void;
}) {
  if (runs.length <= 1) return null;

  return (
    <details className="rounded border border-slate-200 dark:border-slate-800" data-testid="run-history">
      <summary className="cursor-pointer px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
        Run history <span className="tabular-nums text-slate-400">({runs.length})</span>
      </summary>

      <ul className="border-t border-slate-200 dark:border-slate-800">
        {runs.map((run, index) => {
          const selected = run.id === selectedRunId;
          const duration = formatDuration(run);
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                aria-current={selected ? "true" : undefined}
                data-testid="run-history-item"
                data-run-id={run.id}
                className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "bg-slate-100 dark:bg-slate-800"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                <span className="tabular-nums text-slate-400">
                  #{runs.length - index}
                </span>
                <StatusBadge status={run.status} />
                <span className="text-slate-500">{formatWhen(run.startedAt)}</span>
                {duration ? <span className="text-slate-400">· {duration}</span> : null}
                {run.error ? (
                  <span className="min-w-0 truncate text-red-500" title={run.error}>
                    · {run.error}
                  </span>
                ) : null}
                {selected ? <span className="ml-auto text-xs text-slate-400">viewing</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
