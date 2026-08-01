import { describe, expect, it } from "vitest";
import {
  isIosDownloadDevice,
  requiresIndividualShortDownloads,
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

  it("uses individual downloads on Galaxy tablets and other mobile devices", () => {
    const galaxyTabSamsungInternet = [
      "Mozilla/5.0 (Linux; Android 14; SM-X710)",
      "AppleWebKit/537.36 (KHTML, like Gecko)",
      "SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36",
    ].join(" ");
    const androidChrome = [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      "AppleWebKit/537.36 (KHTML, like Gecko)",
      "Chrome/126.0.0.0 Mobile Safari/537.36",
    ].join(" ");
    const desktopChrome = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "AppleWebKit/537.36 (KHTML, like Gecko)",
      "Chrome/126.0.0.0 Safari/537.36",
    ].join(" ");

    expect(requiresIndividualShortDownloads(galaxyTabSamsungInternet)).toBe(true);
    expect(requiresIndividualShortDownloads(androidChrome)).toBe(true);
    expect(requiresIndividualShortDownloads("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15")).toBe(true);
    expect(requiresIndividualShortDownloads("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15", 5)).toBe(true);
    expect(requiresIndividualShortDownloads(desktopChrome)).toBe(false);
  });
});
