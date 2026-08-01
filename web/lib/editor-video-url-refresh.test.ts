import { describe, expect, it } from "vitest";
import {
  EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS,
  editorVideoUrlRefreshDelay,
} from "@/lib/editor-video-url-refresh";

describe("editor video URL refresh", () => {
  it("refreshes a 15 minute URL two minutes before expiry", () => {
    const now = Date.parse("2026-08-01T00:00:00.000Z");
    expect(editorVideoUrlRefreshDelay(
      "2026-08-01T00:15:00.000Z",
      now,
    )).toBe(13 * 60_000);
  });

  it("refreshes promptly when the URL is already near expiry or invalid", () => {
    const now = Date.parse("2026-08-01T00:00:00.000Z");
    expect(editorVideoUrlRefreshDelay(
      "2026-08-01T00:01:00.000Z",
      now,
    )).toBe(EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS);
    expect(editorVideoUrlRefreshDelay("invalid", now)).toBe(
      EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS,
    );
  });
});
