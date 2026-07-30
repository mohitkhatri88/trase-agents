import { useEffect, useState } from "react";
import type { Agent } from "@trase/core";
import { useCreateTask } from "../queries.js";

export function NewTaskForm({
  agents,
  defaultAgentId,
}: {
  agents: Agent[];
  defaultAgentId?: number | null;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // A real, changeable picker — not a fixed label derived from selection.
  // It is also what makes the "400 for a nonexistent agent" path reachable
  // from the UI at all.
  const [agentId, setAgentId] = useState<number | "">(defaultAgentId ?? "");
  const create = useCreateTask();

  useEffect(() => {
    if (defaultAgentId != null) setAgentId(defaultAgentId);
  }, [defaultAgentId]);

  const incomplete = title.trim() === "" || description.trim() === "" || agentId === "";

  return (
    <form
      data-testid="new-task-form"
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (incomplete) return;
        create.mutate(
          { title: title.trim(), description: description.trim(), agentId: Number(agentId) },
          {
            onSuccess: () => {
              setTitle("");
              setDescription("");
            },
          },
        );
      }}
    >
      <input
        aria-label="Task title"
        placeholder="Task title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <input
        aria-label="Task description"
        placeholder="What should the agent do?"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Assign to agent"
          value={agentId}
          onChange={(event) =>
            setAgentId(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">Choose an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={incomplete || create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {create.isPending ? "Creating…" : "Create task"}
        </button>
      </div>

      {create.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : "Could not create the task"}
        </p>
      ) : null}
    </form>
  );
}
