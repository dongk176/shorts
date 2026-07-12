export type InitialJobBackend = "aws_batch" | "mac_pull";

export function getInitialJobBackend(): InitialJobBackend {
  return process.env.VIDEO_JOB_BACKEND === "mac_pull" ? "mac_pull" : "aws_batch";
}
