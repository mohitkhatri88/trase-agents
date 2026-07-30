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
