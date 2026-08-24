import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fileUploadBearerToken,
  fileUploadIntentHash,
  fileUploadReceiverUrl,
  fileUploadTokenHash,
  fileUploadTokenMatchesHash,
  getFileUploadReceiverConfig,
  readLimitedJsonBody,
} from "./file-upload-control";

afterEach(() => vi.unstubAllEnvs());

const identity = {
  uploadSessionId: "5a46c5d2-1578-4238-b561-b09a11faacb1",
  jobId: "6a46c5d2-1578-4238-b561-b09a11faacb2",
  userId: "7a46c5d2-1578-4238-b561-b09a11faacb3",
  requestId: "8a46c5d2-1578-4238-b561-b09a11faacb4",
};

const intent = {
  originalFilename: "source.mp4",
  declaredContentType: "video/mp4",
  sizeBytes: 123_456,
  durationSeconds: 600,
  width: 1920,
  height: 1080,
  hasAudio: true,
  rangeStartSeconds: 60,
  rangeEndSeconds: 360,
  templateId: "dark-minimal",
  customTemplateId: null,
  videoAspectRatio: "1:1",
  outputLanguage: "ko",
  subtitleTemplateId: null,
  subtitleCaptionPlacement: null,
  brandColor: null,
  rightsConfirmed: true,
};

describe("file upload receiver control", () => {
  it("derives a stable bearer while storing only its SHA-256 hash", () => {
    const secret = "s".repeat(64);
    const first = fileUploadBearerToken(secret, identity);
    const second = fileUploadBearerToken(secret, identity);
    const hash = fileUploadTokenHash(first);

    expect(first).toBe(second);
    expect(first).not.toContain(identity.uploadSessionId);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(fileUploadTokenMatchesHash(first, hash)).toBe(true);
    expect(fileUploadTokenMatchesHash(`${first}x`, hash)).toBe(false);
  });

  it("binds an idempotency key to every immutable normalized intent field", () => {
    const hash = fileUploadIntentHash(intent);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(fileUploadIntentHash({ ...intent })).toBe(hash);
    expect(fileUploadIntentHash({
      ...intent,
      rangeEndSeconds: intent.rangeEndSeconds + 1,
    })).not.toBe(hash);
    expect(fileUploadIntentHash({
      ...intent,
      originalFilename: "another.mp4",
    })).not.toBe(hash);
  });

  it("accepts only an HTTPS receiver on the explicit hostname allowlist", () => {
    const config = getFileUploadReceiverConfig({
      FILE_UPLOAD_RECEIVER_URL: "https://uploads.easycut.example/base/",
      FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS: "uploads.easycut.example",
      FILE_UPLOAD_TOKEN_SECRET: "s".repeat(64),
    });

    expect(fileUploadReceiverUrl(
      config.receiverBaseUrl,
      identity.uploadSessionId,
    )).toBe(
      `https://uploads.easycut.example/base/v1/upload-sessions/${identity.uploadSessionId}/source`,
    );
  });

  it("accepts plain HTTP only for an explicit non-production loopback test", () => {
    const config = getFileUploadReceiverConfig({
      NODE_ENV: "development",
      UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED: "true",
      FILE_UPLOAD_RECEIVER_URL: "http://127.0.0.1:8090",
      FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS: "127.0.0.1",
      FILE_UPLOAD_TOKEN_SECRET: "s".repeat(64),
    });

    expect(config.receiverBaseUrl.toString()).toBe("http://127.0.0.1:8090/");
    expect(() => getFileUploadReceiverConfig({
      NODE_ENV: "production",
      UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED: "true",
      FILE_UPLOAD_RECEIVER_URL: "http://127.0.0.1:8090",
      FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS: "127.0.0.1",
      FILE_UPLOAD_TOKEN_SECRET: "s".repeat(64),
    })).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it.each([
    { FILE_UPLOAD_RECEIVER_URL: "http://uploads.easycut.example" },
    { FILE_UPLOAD_RECEIVER_URL: "https://unexpected.example" },
    { FILE_UPLOAD_RECEIVER_URL: "https://uploads.easycut.example?token=bad" },
    { FILE_UPLOAD_TOKEN_SECRET: "too-short" },
    { FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS: "" },
  ])("fails closed for an unsafe or incomplete receiver config", (override) => {
    expect(() => getFileUploadReceiverConfig({
      FILE_UPLOAD_RECEIVER_URL: "https://uploads.easycut.example",
      FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS: "uploads.easycut.example",
      FILE_UPLOAD_TOKEN_SECRET: "s".repeat(64),
      ...override,
    })).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it("caps streamed JSON even without a Content-Length header", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(256) }),
    });

    await expect(readLimitedJsonBody(request, 64)).rejects.toMatchObject({
      status: 413,
    });
  });
});
