import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Agent } from "@trase/core";
import { EmptyState } from "./states.js";

export function AgentList({
  agents,
  selectedId,
}: {
  agents: Agent[];
  selectedId: number | null;
}) {
  const [filter, setFilter] = useState("");

  // Filtered client-side: the dataset is small, and a debounced round-trip
  // would be both slower and worse. Server-side search is the change to make
  // at a few hundred agents, not now.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(needle) ||
        agent.description.toLowerCase().includes(needle),
    );
  }, [agents, filter]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="Filter agents"
        placeholder="Filter agents…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
      />

      {visible.length === 0 ? (
        <EmptyState
          title={agents.length === 0 ? "No agents yet" : "No agents match that filter"}
          hint={
            agents.length === 0
              ? "Sample agents are seeded automatically on first boot."
              : "Try a different search term."
          }
        />
      ) : (
        <ul className="space-y-2" aria-label="Agents">
          {visible.map((agent) => (
            <li key={agent.id}>
              <Link
                to={`/agents/${agent.id}`}
                aria-current={agent.id === selectedId ? "true" : undefined}
                data-testid="agent-card"
                className={`block rounded-lg border p-3 transition-colors ${
                  agent.id === selectedId
                    ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
                    : "border-slate-200 hover:border-slate-400 dark:border-slate-800"
                }`}
              >
                <p className="font-medium">{agent.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{agent.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
