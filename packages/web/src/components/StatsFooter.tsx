import { useStats } from "../queries.js";

export function StatsFooter() {
  const stats = useStats();

  if (stats.isError) {
    return <p className="text-sm text-slate-400">Stats unavailable.</p>;
  }
  if (!stats.data) {
    return <p className="text-sm text-slate-400">Loading stats…</p>;
  }

  const { agents, tasks, runs } = stats.data;
  const totalRuns = Object.values(runs).reduce((sum, n) => sum + n, 0);

  const cells = [
    { label: "Agents", value: agents, testId: "stat-agents" },
    { label: "Tasks", value: tasks, testId: "stat-tasks" },
    { label: "Runs", value: totalRuns, testId: "stat-runs" },
    { label: "Succeeded", value: runs.completed, testId: "stat-succeeded" },
    { label: "Failed", value: runs.failed, testId: "stat-failed" },
    { label: "Active", value: runs.queued + runs.running, testId: "stat-active" },
  ];

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="stats-footer">
      {cells.map((cell) => (
        <div key={cell.label} className="flex items-baseline gap-1.5">
          <dt className="text-slate-500">{cell.label}</dt>
          <dd className="font-medium tabular-nums" data-testid={cell.testId}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
