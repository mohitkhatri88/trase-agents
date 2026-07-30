import { useState } from "react";
import type { AgentBehaviour } from "@trase/core";
import { useCreateAgent } from "../queries.js";

const BEHAVIOURS: Array<{ value: AgentBehaviour; label: string; hint: string }> = [
  { value: "reliable", label: "Reliable", hint: "Rarely fails, finishes in a few seconds" },
  { value: "flaky", label: "Flaky", hint: "Fails roughly a third of the time" },
  { value: "slow", label: "Slow", hint: "Four long steps — easy to cancel mid-run" },
];

export function NewAgentForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The client picks a character; the server owns the timings and failure
  // rates. Without this every created agent would run identically, and the
  // feature would be one you could use but never see the result of.
  const [behaviour, setBehaviour] = useState<AgentBehaviour>("reliable");

  const create = useCreateAgent();
  const incomplete = name.trim() === "" || description.trim() === "";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="new-agent-toggle"
        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
      >
        + New agent
      </button>
    );
  }

  return (
    <form
      data-testid="new-agent-form"
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (incomplete) return;
        create.mutate(
          { name: name.trim(), description: description.trim(), behaviour },
          {
            onSuccess: () => {
              setName("");
              setDescription("");
              setBehaviour("reliable");
              setOpen(false);
            },
          },
        );
      }}
    >
      <input
        aria-label="Agent name"
        placeholder="Agent name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <input
        aria-label="Agent description"
        placeholder="What class of job does it handle?"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-500">Behaviour when run</legend>
        {BEHAVIOURS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <input
              type="radio"
              name="behaviour"
              value={option.value}
              checked={behaviour === option.value}
              onChange={() => setBehaviour(option.value)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="font-medium">{option.label}</span>
              <span className="block text-xs text-slate-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={incomplete || create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {create.isPending ? "Creating…" : "Create agent"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          Cancel
        </button>
      </div>

      {create.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : "Could not create the agent"}
        </p>
      ) : null}
    </form>
  );
}
