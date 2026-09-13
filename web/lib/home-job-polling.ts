import type { VideoJob } from "./contracts";

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);

export function jobNeedsPolling(job: Pick<VideoJob, "status" | "shorts">) {
  return !terminalStatuses.has(job.status)
    || job.shorts.some((short) => short.status === "rerendering");
}

/** One sequential loop owns all home job updates, including enterprise jobs. */
export function startHomeJobPolling<T extends { job: VideoJob }>({
  jobIds, read, apply, settled, failed,
}: {
  jobIds: string[];
  read: (id: string, signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  settled: () => Promise<void>;
  failed: (error: unknown) => void;
}) {
  const pending = new Set(jobIds);
  const controller = new AbortController();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    for (const id of pending) {
      try {
        const value = await read(id, controller.signal);
        if (controller.signal.aborted) return;
        if (!jobNeedsPolling(value.job)) {
          pending.delete(id);
          void settled().catch((error) => {
            if (!controller.signal.aborted) failed(error);
          });
        }
        apply(value);
      } catch (error) {
        if (controller.signal.aborted) return;
        failed(error);
      }
    }
    if (!controller.signal.aborted && pending.size) {
      const elapsed = Date.now() - started;
      timer = setTimeout(poll, elapsed < 30_000 ? 3_000 : elapsed < 300_000 ? 6_000 : 10_000);
    }
  };
  if (pending.size) timer = setTimeout(poll, 3_000);
  return () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };
}
