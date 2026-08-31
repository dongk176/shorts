import { describe, expect, it } from "vitest";
import { fileUploadSessionPublicStatus } from "./file-upload-session-state";

describe("file upload public session state", () => {
  it.each([
    ["awaiting_upload", "uploading", false, "ready"],
    ["claimed", "uploading", false, "uploading"],
    ["claimed", "queued", true, "received"],
    ["claimed", "transcribing", true, "processing"],
    ["claimed", "completed", true, "processing"],
    ["claimed", "failed", true, "processing"],
    ["completed", "completed", true, "completed"],
    ["failed", "completed", true, "completed"],
    ["expired", "completed", true, "completed"],
    ["cancelled", "completed", true, "completed"],
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

  it("does not infer receiver completion from a project outcome alone", () => {
    expect(fileUploadSessionPublicStatus({
      receiverStatus: "claimed", jobStatus: "completed", received: true,
    })).toBe("processing");
    expect(fileUploadSessionPublicStatus({
      receiverStatus: "unrecognized", jobStatus: "completed", received: true,
    })).toBe("failed");
  });
});
