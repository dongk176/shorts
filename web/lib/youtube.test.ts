import { beforeEach, describe, expect, it, vi } from "vitest";

const playbackMocks = vi.hoisted(() => ({
  verify: vi.fn(),
}));

vi.mock("@/lib/youtube-playback", () => ({
  verifyYoutubePlaybackAvailability: playbackMocks.verify,
}));

import { analyzeYoutubeUrl, normalizeYoutubeUrl } from "./youtube";

beforeEach(() => {
  playbackMocks.verify.mockReset();
  playbackMocks.verify.mockResolvedValue({
    creationAllowed: true,
    creationBlockCode: null,
    creationBlockReason: null,
  });
});

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
  it("loads the actual channel thumbnail from the YouTube channel metadata", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: "dQw4w9WgXcQ",
          snippet: {
            title: "영상",
            channelTitle: "실제 채널",
            channelId: "UC1234567890",
            thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
          },
          contentDetails: { duration: "PT2M" },
          status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          snippet: {
            thumbnails: {
              default: { url: "https://yt3.ggpht.com/small" },
              high: { url: "https://yt3.ggpht.com/high" },
            },
          },
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      channelName: "실제 채널",
      channelThumbnailUrl: "https://yt3.ggpht.com/high",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/youtube/v3/channels");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));

    const result = await analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ");

    expect(Array.from(result.channelName)).toHaveLength(50);
    expect(result.channelName.endsWith("😀")).toBe(true);
    expect(result).toMatchObject({ creationAllowed: true, creationBlockReason: null });
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("status");
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
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));
    await expect(
      analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toThrow("최대 60분");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    {
      contentDetails: { duration: "PT2M", regionRestriction: { allowed: ["KR"] } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "region_restricted",
    },
    {
      contentDetails: { duration: "PT2M", regionRestriction: { blocked: ["US"] } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "region_restricted",
    },
    {
      contentDetails: { duration: "PT2M", contentRating: { ytRating: "ytAgeRestricted" } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "age_restricted",
    },
    {
      contentDetails: { duration: "PT2M" },
      status: { uploadStatus: "processed", privacyStatus: "unlisted", embeddable: true },
      code: "not_public",
    },
    {
      contentDetails: { duration: "PT2M" },
      status: { uploadStatus: "uploaded", privacyStatus: "public", embeddable: true },
      code: "not_processed",
    },
    {
      contentDetails: { duration: "PT2M" },
      status: { uploadStatus: "deleted", privacyStatus: "public", embeddable: true },
      code: "removed",
    },
    {
      contentDetails: { duration: "PT2M" },
      status: {
        uploadStatus: "rejected",
        privacyStatus: "public",
        embeddable: true,
        rejectionReason: "copyright",
      },
      code: "copyright_restricted",
    },
    {
      contentDetails: { duration: "PT2M" },
      status: {
        uploadStatus: "processed",
        privacyStatus: "private",
        embeddable: true,
        publishAt: "2099-01-01T00:00:00Z",
      },
      code: "not_yet_available",
    },
  ])("marks restricted metadata as $code", async ({ contentDetails, status, code }) => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "제한 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails,
        status,
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: code,
    });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("allows public videos with external playback disabled", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "외부 재생 제한 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: false },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: true,
      creationBlockCode: null,
      creationBlockReason: null,
    });
    expect(playbackMocks.verify).toHaveBeenCalledWith("dQw4w9WgXcQ");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails closed when YouTube omits the availability status", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "상태 미확인 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "availability_unverified",
    });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("blocks a video when the direct playback response requires membership", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "멤버십 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));
    playbackMocks.verify.mockResolvedValue({
      creationAllowed: false,
      creationBlockCode: "members_only",
      creationBlockReason: "이 영상은 채널 멤버십 전용 영상입니다.",
    });

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "members_only",
    });
    expect(playbackMocks.verify).toHaveBeenCalledWith("dQw4w9WgXcQ");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("allows a public video when direct playback receives a bot challenge", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "공개 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));
    playbackMocks.verify.mockResolvedValue({
      creationAllowed: false,
      creationBlockCode: "bot_challenge",
      creationBlockReason: "이 영상은 현재 YouTube에서 재생 가능 여부를 확인할 수 없는 상태입니다.",
    });

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: true,
      creationBlockCode: null,
      creationBlockReason: null,
    });
    expect(playbackMocks.verify).toHaveBeenCalledWith("dQw4w9WgXcQ");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("blocks an upcoming video before making a playback request", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "예약 공개",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
        liveStreamingDetails: { scheduledStartTime: "2026-07-18T00:00:00Z" },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "not_yet_available",
    });
    expect(playbackMocks.verify).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
