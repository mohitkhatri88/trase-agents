import type { ReactNode } from "react";
import type { TaskWithAgent } from "@trase/core";
import { StatusBadge } from "./StatusBadge.js";
import { EmptyState } from "./states.js";

export function TaskList({
  tasks,
  expandedTaskId,
  onToggle,
  renderExpanded,
  emptyTitle = "No tasks yet",
  emptyHint = "Create one with the form above.",
}: {
  tasks: TaskWithAgent[];
  expandedTaskId: number | null;
  onToggle: (id: number) => void;
  renderExpanded?: (task: TaskWithAgent) => ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  if (tasks.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <ul className="space-y-2" aria-label="Tasks">
      {tasks.map((task) => {
        const expanded = task.id === expandedTaskId;
        return (
          <li
            key={task.id}
            data-testid="task-row"
            data-task-id={task.id}
            className="rounded-lg border border-slate-200 dark:border-slate-800"
          >
            <div className="flex flex-wrap items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => onToggle(task.id)}
                aria-expanded={expanded}
                className="min-w-0 flex-1 text-left"
              >
                <p className="font-medium">{task.title}</p>
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  <span data-testid="task-agent">{task.agent.name}</span> · {task.description}
                </p>
              </button>
              <StatusBadge status={task.status} />
            </div>

            {expanded && renderExpanded ? (
              <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                {renderExpanded(task)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
