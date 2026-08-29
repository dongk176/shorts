export type FileUploadSessionPublicStatus =
  | "preparing"
  | "ready"
  | "uploading"
  | "received"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export function fileUploadSessionPublicStatus(input: {
  receiverStatus: string;
  jobStatus: string;
  received: boolean;
}): FileUploadSessionPublicStatus {
  if (input.receiverStatus === "awaiting_upload") return "ready";
  if (input.receiverStatus === "claimed") {
    if (input.jobStatus === "uploading") return "uploading";
    if (input.received && input.jobStatus === "queued") return "received";
    return "processing";
  }
  if (["completed", "failed", "cancelled", "expired"].includes(
    input.receiverStatus,
  )) {
    return input.receiverStatus as FileUploadSessionPublicStatus;
  }
  return "failed";
}
