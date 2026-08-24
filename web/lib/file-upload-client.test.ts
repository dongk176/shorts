import { describe, expect, it } from "vitest";
import {
  assertUploadFileCandidate,
  DirectUploadError,
  FILE_UPLOAD_MAX_BYTES,
  uploadContentType,
} from "@/lib/file-upload-client";

describe("file upload client preflight", () => {
  it("accepts supported video MIME types and extension fallbacks", () => {
    expect(() => assertUploadFileCandidate({
      name: "source.mov",
      size: 1024,
      type: "video/quicktime",
    })).not.toThrow();
    expect(() => assertUploadFileCandidate({
      name: "camera.MKV",
      size: 1024,
      type: "",
    })).not.toThrow();
  });

  it("uses the same content type for the intent and the direct upload", () => {
    expect(uploadContentType({ type: "video/quicktime" })).toBe("video/quicktime");
    expect(uploadContentType({ type: "" })).toBe("application/octet-stream");
    expect(uploadContentType({ type: "   " })).toBe("application/octet-stream");
  });

  it("rejects zero, oversized, and unrelated files before metadata work", () => {
    expect(() => assertUploadFileCandidate({
      name: "source.mp4",
      size: 0,
      type: "video/mp4",
    })).toThrow("5GB 이하");
    expect(() => assertUploadFileCandidate({
      name: "source.mp4",
      size: FILE_UPLOAD_MAX_BYTES + 1,
      type: "video/mp4",
    })).toThrow("5GB 이하");
    expect(() => assertUploadFileCandidate({
      name: "notes.txt",
      size: 100,
      type: "text/plain",
    })).toThrow("MP4, MOV");
  });

  it("keeps receiver status and code for terminal upload handling", () => {
    const error = new DirectUploadError(
      422,
      "영상 길이가 일치하지 않습니다.",
      "upload_duration_mismatch",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.code).toBe("upload_duration_mismatch");
  });
});
