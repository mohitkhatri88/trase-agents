import type { TaskStatus } from "@trase/core";

const LABELS: Record<TaskStatus, string> = {
  never_run: "Never run",
  queued: "Queued",
  running: "Running",
  completed: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STYLES: Record<TaskStatus, string> = {
  never_run: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

export function StatusBadge({
  status,
  live = false,
}: {
  status: TaskStatus;
  /** Announce changes to screen readers. Only the focused run panel sets this —
   *  a live region per task row would make a polled list announce constantly. */
  live?: boolean;
}) {
  const busy = status === "running" || status === "queued";
  return (
    <span
      role={live ? "status" : undefined}
      aria-busy={busy}
      data-status={status}
      data-testid="status-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {busy ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
      {LABELS[status]}
    </span>
  );
}
