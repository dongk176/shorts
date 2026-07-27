import { describe, expect, it } from "vitest";
import {
  isIosDownloadDevice,
  shortDownloadContentDisposition,
  shortDownloadExpirySeconds,
  shortDownloadFilename,
} from "@/lib/short-download";

describe("short download helpers", () => {
  it("creates a safe Korean mp4 filename", () => {
    expect(shortDownloadFilename("핵심: 제목 / 테스트?")).toBe("핵심 제목  테스트.mp4");
    expect(shortDownloadFilename("?!")).toBe("shorts.mp4");
  });

  it("creates an attachment disposition with ASCII and UTF-8 names", () => {
    const value = shortDownloadContentDisposition("핵심 장면.mp4");
    expect(value).toContain('attachment; filename="easy-cut-shorts.mp4"');
    expect(value).toContain("filename*=UTF-8''%ED%95%B5%EC%8B%AC%20%EC%9E%A5%EB%A9%B4.mp4");
    expect(value).not.toContain("\n");
  });

  it("never signs beyond five minutes or the output expiry", () => {
    const now = Date.parse("2026-07-27T00:00:00.000Z");
    expect(shortDownloadExpirySeconds(null, now)).toBe(300);
    expect(shortDownloadExpirySeconds("2026-07-27T00:01:30.000Z", now)).toBe(90);
    expect(shortDownloadExpirySeconds("2026-07-26T23:59:00.000Z", now)).toBe(1);
  });

  it("detects iOS and touch-mode iPadOS without flagging desktop Safari", () => {
    expect(isIosDownloadDevice("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15")).toBe(true);
    expect(isIosDownloadDevice("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15", 5)).toBe(true);
    expect(isIosDownloadDevice("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15", 0)).toBe(false);
  });
});
