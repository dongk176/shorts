import { describe, expect, it } from "vitest";
import { normalizeYoutubeUrl } from "./youtube";

describe("YouTube URL allowlist", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
  ])("normalizes %s", (url) => {
    expect(normalizeYoutubeUrl(url)).toEqual({
      videoId: "dQw4w9WgXcQ",
      normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it.each([
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=too-short",
  ])("rejects %s", (url) => {
    expect(() => normalizeYoutubeUrl(url)).toThrow();
  });
});
