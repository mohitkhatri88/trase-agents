import { useState } from "react";
import { useAgents, useTasks } from "../queries.js";
import { Layout } from "../components/Layout.js";
import { TaskList } from "../components/TaskList.js";
import { NewTaskForm } from "../components/NewTaskForm.js";
import { RunPanel } from "../components/RunPanel.js";
import { Skeleton, ErrorState } from "../components/states.js";

/**
 * Exists because the brief asks for a task list showing status AND assigned
 * agent. Inside a selected agent the agent is implicit, so that column would
 * have nothing to show.
 */
export function AllTasksPage() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const agents = useAgents();
  const tasks = useTasks();

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-4">
        {agents.data ? <NewTaskForm agents={agents.data} /> : null}

        {tasks.isPending ? (
          <Skeleton rows={5} />
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : (
          <TaskList
            tasks={tasks.data}
            expandedTaskId={expanded}
            onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
            renderExpanded={(task) => <RunPanel task={task} />}
          />
        )}
      </div>
    </Layout>
  );
}
