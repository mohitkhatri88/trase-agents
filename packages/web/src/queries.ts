import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export const queryKeys = {
  agents: ["agents"] as const,
  tasks: (agentId?: number) => ["tasks", agentId ?? "all"] as const,
  task: (id: number) => ["task", id] as const,
  stats: ["stats"] as const,
};

/**
 * Statuses in the task list are polled rather than streamed.
 *
 * A two-second lag on a status badge is invisible, and polling keeps us to a
 * single live connection — the run the user has actually expanded. That
 * sidesteps the browser's per-origin connection limit entirely instead of
 * merely documenting it.
 */
const LIST_POLL_MS = 2000;

export function useAgents() {
  return useQuery({ queryKey: queryKeys.agents, queryFn: api.agents.list });
}

export function useTasks(agentId?: number) {
  return useQuery({
    queryKey: queryKeys.tasks(agentId),
    queryFn: () => api.tasks.list(agentId),
    refetchInterval: LIST_POLL_MS,
  });
}

/**
 * Task detail, which carries the full run history. Fetched only for the task
 * the user has expanded — the list endpoint deliberately doesn't carry runs.
 */
export function useTask(id: number | null) {
  return useQuery({
    queryKey: queryKeys.task(id ?? -1),
    queryFn: () => api.tasks.get(id as number),
    enabled: id !== null,
    refetchInterval: LIST_POLL_MS,
  });
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: api.stats.get,
    refetchInterval: LIST_POLL_MS,
  });
}

export function useInvalidateAll() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["tasks"] });
    void client.invalidateQueries({ queryKey: ["task"] });
    void client.invalidateQueries({ queryKey: queryKeys.stats });
  };
}

export function useCreateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.agents.create,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.agents });
      void client.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.tasks.create, onSuccess: invalidate });
}

export function useRunTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.tasks.run, onSuccess: invalidate });
}

export function useCancelRun() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.runs.cancel, onSuccess: invalidate });
}
