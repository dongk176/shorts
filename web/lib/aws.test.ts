import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFrontSignedUrl: vi.fn(),
}));

vi.mock("@aws-sdk/cloudfront-signer", () => ({
  getSignedUrl: mocks.cloudFrontSignedUrl,
}));

import {
  getProjectSourceThumbnailUrl,
  getShortDownloadUrl,
  latestJobDefinitionName,
} from "@/lib/aws";

describe("getShortDownloadUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.stubEnv("CLOUDFRONT_DOMAIN", "cdn.example.com");
    vi.stubEnv("CLOUDFRONT_KEY_PAIR_ID", "key-pair");
    vi.stubEnv(
      "CLOUDFRONT_PRIVATE_KEY_B64",
      Buffer.from("private-key").toString("base64"),
    );
    mocks.cloudFrontSignedUrl.mockReturnValue("https://cdn.example.com/signed");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("signs the short CloudFront attachment URL for at most five minutes", async () => {
    await expect(getShortDownloadUrl(
      "outputs/session/job/short/v1.mp4",
      "핵심 장면.mp4",
      900,
    )).resolves.toBe("https://cdn.example.com/signed");

    expect(mocks.cloudFrontSignedUrl).toHaveBeenCalledWith({
      url: "https://cdn.example.com/outputs/session/job/short/v1.mp4?download=1&filename=%ED%95%B5%EC%8B%AC%20%EC%9E%A5%EB%A9%B4.mp4",
      keyPairId: "key-pair",
      privateKey: "private-key",
      dateLessThan: "2026-07-29T00:05:00.000Z",
    });
  });

  it("rejects paths outside generated output mp4 files", async () => {
    await expect(getShortDownloadUrl("../private/source.mp4", "제목.mp4", 300))
      .rejects.toThrow("다운로드할 수 없는 영상 경로입니다.");
    expect(mocks.cloudFrontSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects unsafe download filenames", async () => {
    await expect(getShortDownloadUrl(
      "outputs/session/job/short/v1.mp4",
      "제목\r\nx-test.mp4",
      300,
    )).rejects.toThrow("다운로드 파일명이 올바르지 않습니다.");
    expect(mocks.cloudFrontSignedUrl).not.toHaveBeenCalled();
  });
});

describe("latestJobDefinitionName", () => {
  it("uses the latest active revision for a Batch ARN", () => {
    expect(latestJobDefinitionName(
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-short-production:2",
    )).toBe("shorts-mvp-short-production");
  });

  it("removes an explicit revision from a job definition name", () => {
    expect(latestJobDefinitionName("shorts-mvp-long-production:7"))
      .toBe("shorts-mvp-long-production");
  });

  it("keeps an unversioned job definition name", () => {
    expect(latestJobDefinitionName("shorts-mvp-short-production"))
      .toBe("shorts-mvp-short-production");
  });
});

describe("getProjectSourceThumbnailUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.stubEnv("CLOUDFRONT_DOMAIN", "cdn.example.com");
    vi.stubEnv("CLOUDFRONT_KEY_PAIR_ID", "key-pair");
    vi.stubEnv(
      "CLOUDFRONT_PRIVATE_KEY_B64",
      Buffer.from("private-key").toString("base64"),
    );
    mocks.cloudFrontSignedUrl.mockReturnValue("https://cdn.example.com/signed");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("signs only a thumbnails jpg URL for at most fifteen minutes", async () => {
    await expect(getProjectSourceThumbnailUrl({
      key: "thumbnails/session/job/source.jpg",
      expiresAt: null,
    })).resolves.toBe("https://cdn.example.com/signed");

    expect(mocks.cloudFrontSignedUrl).toHaveBeenCalledWith({
      url: "https://cdn.example.com/thumbnails/session/job/source.jpg",
      keyPairId: "key-pair",
      privateKey: "private-key",
      dateLessThan: "2026-07-29T00:15:00.000Z",
    });
  });

  it("rejects paths outside the private thumbnail namespace", async () => {
    await expect(getProjectSourceThumbnailUrl({
      key: "../outputs/private/source.jpg",
      expiresAt: null,
    })).rejects.toThrow("재생할 수 없는 원본 썸네일 경로입니다.");
    expect(mocks.cloudFrontSignedUrl).not.toHaveBeenCalled();
  });
});
