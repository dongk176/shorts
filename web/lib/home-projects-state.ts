import type { MvpState, VideoJob } from "./contracts";

export function mergeHomeCore(current: MvpState | null, incoming: MvpState): MvpState {
  if (incoming.recentJobsLoaded !== false || current?.user?.id !== incoming.user?.id) return incoming;
  return { ...incoming, recentJobs: current?.recentJobs ?? [] };
}

export function mergeHomeProjects(
  current: MvpState | null,
  response: { userId: string | null; recentJobs: VideoJob[] },
  requestedAt: number,
): MvpState | null {
  if (!current || (current.user?.id ?? null) !== response.userId) return current;
  const ids = new Set(response.recentJobs.map(job => job.id));
  // A list started before a new submission must not remove that optimistic card.
  const submitted = current.recentJobs.filter(job => !ids.has(job.id) && Date.parse(job.createdAt) >= requestedAt);
  return { ...current, recentJobs: [...submitted, ...response.recentJobs], recentJobsLoaded: true };
}
