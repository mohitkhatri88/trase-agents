import type { Db } from "../db/client.js";
import { createAgentStore, type AgentStore } from "./agents.js";
import { createTaskStore, type TaskStore } from "./tasks.js";
import { createRunStore, type RunStore } from "./runs.js";

export interface Store {
  agents: AgentStore;
  tasks: TaskStore;
  runs: RunStore;
}

export function createStore(db: Db): Store {
  return {
    agents: createAgentStore(db),
    tasks: createTaskStore(db),
    runs: createRunStore(db),
  };
}

export type { AgentStore, TaskStore, RunStore };
