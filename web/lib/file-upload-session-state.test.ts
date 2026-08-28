import { describe, expect, it } from "vitest";
import { fileUploadSessionPublicStatus } from "./file-upload-session-state";

describe("file upload public session state", () => {
  it.each([
    ["awaiting_upload", "uploading", false, "ready"],
    ["claimed", "uploading", false, "uploading"],
    ["claimed", "queued", true, "received"],
    ["claimed", "transcribing", true, "processing"],
    ["completed", "completed", true, "completed"],
    ["failed", "failed", false, "failed"],
    ["cancelled", "cancelled", false, "cancelled"],
    ["expired", "expired", false, "expired"],
  ])("maps %s/%s to %s", (
    receiverStatus,
    jobStatus,
    received,
    expected,
  ) => {
    expect(fileUploadSessionPublicStatus({
      receiverStatus,
      jobStatus,
      received,
    })).toBe(expected);
  });
});
