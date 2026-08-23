import type { GeneratedShort, VideoJob } from "@/lib/contracts";

const deletableProjectStatuses = new Set(["completed", "failed", "expired"]);

export function projectCanBeDeleted(
  job: Pick<VideoJob, "isExample" | "status"> & {
    shorts: Array<Pick<GeneratedShort, "status">>;
  },
) {
  return !job.isExample
    && deletableProjectStatuses.has(job.status)
    && !job.shorts.some(
      (item) => item.status === "rendering" || item.status === "rerendering",
    );
}
