import { useState } from "react";
import { useParams } from "react-router";
import { useAgents, useTasks } from "../queries.js";
import { Layout } from "../components/Layout.js";
import { AgentList } from "../components/AgentList.js";
import { TaskList } from "../components/TaskList.js";
import { NewTaskForm } from "../components/NewTaskForm.js";
import { RunPanel } from "../components/RunPanel.js";
import { Skeleton, ErrorState, EmptyState } from "../components/states.js";

export function AgentsPage() {
  const params = useParams();
  const selectedId = params.agentId ? Number(params.agentId) : null;
  const [expanded, setExpanded] = useState<number | null>(null);

  const agents = useAgents();
  const tasks = useTasks(selectedId ?? undefined);

  return (
    <Layout>
      <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_1.6fr]">
        <section aria-label="Agents" className="min-w-0">
          {agents.isPending ? (
            <Skeleton rows={4} />
          ) : agents.isError ? (
            <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
          ) : (
            <AgentList agents={agents.data} selectedId={selectedId} />
          )}
        </section>

        <section aria-label="Tasks" className="min-w-0 space-y-4">
          {selectedId === null ? (
            <EmptyState
              title="Select an agent"
              hint="Its tasks will appear here, and you can run them from there."
            />
          ) : (
            <>
              {agents.data ? (
                <NewTaskForm agents={agents.data} defaultAgentId={selectedId} />
              ) : null}

              {tasks.isPending ? (
                <Skeleton rows={3} />
              ) : tasks.isError ? (
                <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
              ) : (
                <TaskList
                  tasks={tasks.data}
                  expandedTaskId={expanded}
                  onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
                  renderExpanded={(task) => <RunPanel task={task} />}
                  emptyTitle="No tasks for this agent yet"
                  emptyHint="Create the first one with the form above."
                />
              )}
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
