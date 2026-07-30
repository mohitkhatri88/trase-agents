export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskStatus = RunStatus | "never_run";
export type EventType = "status" | "log" | "error";

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface SimulationStep {
  label: string;
  minMs: number;
  maxMs: number;
  failureRate: number;
}

export interface SimulationProfile {
  steps: SimulationStep[];
}

/**
 * What a newly created agent should feel like when run.
 *
 * A closed set rather than a free-form profile: the client picks a character,
 * the server owns the timings and failure rates. That keeps arbitrary
 * user-supplied numbers — a 10-minute step, a negative failure rate — out of
 * the engine entirely, so there is nothing to validate.
 */
export type AgentBehaviour = "reliable" | "flaky" | "slow";

export const AGENT_BEHAVIOURS: readonly AgentBehaviour[] = ["reliable", "flaky", "slow"];

export function isAgentBehaviour(value: unknown): value is AgentBehaviour {
  return typeof value === "string" && (AGENT_BEHAVIOURS as readonly string[]).includes(value);
}

export interface Agent {
  id: number;
  name: string;
  description: string;
  createdAt: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  agentId: number;
  createdAt: string;
}

export interface TaskWithAgent extends Task {
  agent: { id: number; name: string };
  status: TaskStatus;
  latestRunId: number | null;
}

export interface Run {
  id: number;
  taskId: number;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  cancelRequested: boolean;
}

export interface RunEvent {
  id: number;
  runId: number;
  seq: number;
  ts: string;
  type: EventType;
  message: string;
}

export interface Stats {
  agents: number;
  tasks: number;
  runs: Record<RunStatus, number>;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
