import { describe, expect, it } from "vitest";
import {
  isIosDownloadDevice,
  shortDownloadExpirySeconds,
  shortDownloadFilename,
} from "@/lib/short-download";

describe("short download helpers", () => {
  it("creates a safe Korean mp4 filename", () => {
    expect(shortDownloadFilename("핵심: 제목 / 테스트?")).toBe("핵심 제목  테스트.mp4");
    expect(shortDownloadFilename("?!")).toBe("shorts.mp4");
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
