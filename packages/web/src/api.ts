import type { Agent, Run, RunEvent, Stats, Task, TaskWithAgent } from "@trase/core";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? res.statusText,
    );
  }

  return (await res.json()) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
});

export type TaskDetail = TaskWithAgent & { runs: Run[] };
export type RunDetail = Run & { events: RunEvent[] };

export const api = {
  agents: {
    list: () => request<Agent[]>("/agents"),
    get: (id: number) => request<Agent>(`/agents/${id}`),
    create: (input: { name: string; description: string }) =>
      request<Agent>("/agents", post(input)),
  },
  tasks: {
    list: (agentId?: number) =>
      request<TaskWithAgent[]>(agentId === undefined ? "/tasks" : `/tasks?agent_id=${agentId}`),
    get: (id: number) => request<TaskDetail>(`/tasks/${id}`),
    create: (input: { title: string; description: string; agentId: number }) =>
      request<Task>("/tasks", post(input)),
    run: (id: number) => request<{ runId: number }>(`/tasks/${id}/run`, post()),
  },
  runs: {
    get: (id: number) => request<RunDetail>(`/runs/${id}`),
    cancel: (id: number) => request<{ cancelled: boolean }>(`/runs/${id}/cancel`, post()),
  },
  stats: {
    get: () => request<Stats>("/stats"),
  },
};
