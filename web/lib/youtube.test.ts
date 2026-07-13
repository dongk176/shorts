import { describe, expect, it, vi } from "vitest";
import { analyzeYoutubeUrl, normalizeYoutubeUrl } from "./youtube";

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

describe("YouTube duration validation", () => {
  it("bounds channel names to the generated-shorts database limit", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "영상",
          channelTitle: "😀".repeat(80),
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
      }],
    }), { status: 200 })));

    const result = await analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ");

    expect(Array.from(result.channelName)).toHaveLength(50);
    expect(result.channelName.endsWith("😀")).toBe(true);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects videos over sixty minutes after server-side metadata lookup", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "긴 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT1H1S" },
      }],
    }), { status: 200 })));
    await expect(
      analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toThrow("최대 60분");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
