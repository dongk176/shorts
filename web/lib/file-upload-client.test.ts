import { describe, expect, it } from "vitest";
import {
  assertUploadFileCandidate,
  DirectUploadError,
  fileUploadCapacityPollDelayMs,
  FILE_UPLOAD_MAX_BYTES,
  uploadContentType,
  uploadFileWhenReceiverReady,
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

  it("jitters capacity polling to avoid synchronized status bursts", () => {
    expect(fileUploadCapacityPollDelayMs(0)).toBe(10_000);
    expect(fileUploadCapacityPollDelayMs(0.5)).toBe(12_000);
    expect(fileUploadCapacityPollDelayMs(1)).toBe(14_000);
  });
});

describe("scale-to-zero upload recovery", () => {
  const file = { size: 1024, type: "video/mp4" } as File;
  const base = {
    file,
    uploadUrl: "https://upload.example.com/v1/upload",
    bearerToken: "token",
    preparationExpiresAt: "2026-08-28T12:30:00.000Z",
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    wait: async () => undefined,
  };

  const ready = {
    status: "ready",
    received: false,
    expiresAt: "2026-08-28T12:15:00.000Z",
  };

  it("does not send any file bytes until this session has a healthy grant", async () => {
    const states = [
      { status: "preparing", received: false },
      { status: "preparing", received: false },
      ready,
    ];
    let attempts = 0;
    const waiting: number[] = [];

    await uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => { attempts += 1; },
      getSessionState: async () => states.shift() || ready,
      onWaiting: (attempt) => waiting.push(attempt),
    });

    expect(attempts).toBe(1);
    expect(waiting).toEqual([1, 2]);
  });

  it("keeps waiting without sending bytes through a transient status error", async () => {
    const states: Array<Error | typeof ready> = [
      new Error("temporary control-plane failure"),
      ready,
    ];
    let attempts = 0;
    const waiting: number[] = [];

    await uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => { attempts += 1; },
      getSessionState: async () => {
        const state = states.shift() || ready;
        if (state instanceof Error) throw state;
        return state;
      },
      onWaiting: (attempt) => waiting.push(attempt),
    });

    expect(attempts).toBe(1);
    expect(waiting).toEqual([1]);
  });

  it("retries a cold receiver only while the session remains unclaimed", async () => {
    let attempts = 0;
    let stateReads = 0;
    await uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new DirectUploadError(503, "warming");
        }
      },
      getSessionState: async () => {
        stateReads += 1;
        return ready;
      },
    });
    expect(attempts).toBe(2);
    expect(stateReads).toBe(2);
  });

  it("accepts a lost final response when the server recorded the source", async () => {
    let attempts = 0;
    await uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => {
        attempts += 1;
        throw new Error("connection lost");
      },
      getSessionState: async () => attempts === 0
        ? ready
        : { status: "processing", received: true },
    });
    expect(attempts).toBe(1);
  });

  it("never replays bytes after a receiver claimed the one-use bearer", async () => {
    let attempts = 0;
    await expect(uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => {
        attempts += 1;
        throw new DirectUploadError(503, "connection lost");
      },
      getSessionState: async () => attempts === 0
        ? ready
        : { status: "uploading", received: false },
    })).rejects.toMatchObject({ status: 503 });
    expect(attempts).toBe(1);
  });

  it("surfaces terminal cleanup instead of retrying", async () => {
    await expect(uploadFileWhenReceiverReady({
      ...base,
      uploadAttempt: async () => undefined,
      getSessionState: async () => ({
        status: "failed",
        received: false,
        failureReason: "원본이 정리되었습니다.",
      }),
    })).rejects.toMatchObject({
      code: "upload_session_failed",
      message: "원본이 정리되었습니다.",
    });
  });
});
