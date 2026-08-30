import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeYoutubeUrl, normalizeYoutubeUrl } from "./youtube";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("YouTube URL allowlist", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?si=share-token",
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
    "https://youtube.com/live/too-short",
    "https://youtube.com/live/dQw4w9WgXcQ/extra",
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
          contentDetails: { duration: "PT3M" },
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
        contentDetails: { duration: "PT3M" },
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

  it("rejects videos shorter than three minutes with a clear long-form requirement", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "짧은 영상",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT2M59S" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));

    await expect(
      analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toMatchObject({
      status: 400,
      code: "SOURCE_VIDEO_TOO_SHORT",
      message: "롱폼 영상만 사용할 수 있어요. 쇼츠를 만들려면 3분 이상의 영상을 입력해 주세요.",
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts metadata for videos over sixty minutes", async () => {
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
    ).resolves.toMatchObject({ durationSeconds: 3601 });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    {
      contentDetails: { duration: "PT3M", regionRestriction: { allowed: ["KR"] } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "region_restricted",
    },
    {
      contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "region_restricted",
    },
    {
      contentDetails: { duration: "PT3M", contentRating: { ytRating: "ytAgeRestricted" } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "age_restricted",
    },
    {
      contentDetails: { duration: "PT3M" },
      status: { uploadStatus: "processed", privacyStatus: "unlisted", embeddable: true },
      code: "not_public",
    },
    {
      contentDetails: { duration: "PT3M" },
      status: { uploadStatus: "uploaded", privacyStatus: "public", embeddable: true },
      code: "not_processed",
    },
    {
      contentDetails: { duration: "PT3M" },
      status: { uploadStatus: "deleted", privacyStatus: "public", embeddable: true },
      code: "removed",
    },
    {
      contentDetails: { duration: "PT3M" },
      status: {
        uploadStatus: "rejected",
        privacyStatus: "public",
        embeddable: true,
        rejectionReason: "copyright",
      },
      code: "copyright_restricted",
    },
    {
      contentDetails: { duration: "PT3M" },
      status: {
        uploadStatus: "processed",
        privacyStatus: "private",
        embeddable: true,
        publishAt: "2099-01-01T00:00:00Z",
      },
      code: "not_yet_available",
    },
  ])("marks restricted metadata as $code with the unified message", async ({ contentDetails, status, code }) => {
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
      creationBlockReason: "유효하지 않거나 현재 시청할 수 없는 영상입니다 (비공개, 삭제, 또는 멤버십 전용)",
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
        contentDetails: { duration: "PT3M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: false },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: true,
      creationBlockCode: null,
      creationBlockReason: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);

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
        contentDetails: { duration: "PT3M" },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "availability_unverified",
    });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects an unavailable video without requesting the watch page", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(
      "유효하지 않거나 현재 시청할 수 없는 영상입니다 (비공개, 삭제, 또는 멤버십 전용)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("googleapis.com/youtube/v3/videos");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("blocks an upcoming video using Data API metadata only", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "예약 공개",
          channelTitle: "채널",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT3M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
        liveStreamingDetails: { scheduledStartTime: "2026-07-18T00:00:00Z" },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "not_yet_available",
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps ordinary public VODs allowed when live replay support is disabled by default", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "일반 영상",
          channelTitle: "채널",
          liveBroadcastContent: "none",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT3M" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: true,
      creationBlockCode: null,
    });
  });

  it("allows a completed public replay only when the direct-input option is enabled", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const responseBody = JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "완료된 라이브 다시보기",
          channelTitle: "채널",
          liveBroadcastContent: "none",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration: "PT1H" },
        status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
        liveStreamingDetails: {
          actualStartTime: "2026-08-01T00:00:00Z",
          actualEndTime: "2026-08-01T01:00:00Z",
        },
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(
      () => Promise.resolve(new Response(responseBody, { status: 200 })),
    ));

    await expect(analyzeYoutubeUrl("https://youtube.com/live/dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "not_yet_available",
    });
    await expect(analyzeYoutubeUrl(
      "https://youtube.com/live/dQw4w9WgXcQ",
      { allowCompletedLiveReplay: true },
    )).resolves.toMatchObject({
      creationAllowed: true,
      creationBlockCode: null,
      durationSeconds: 3600,
    });
  });

  it.each([
    {
      name: "예약 라이브",
      duration: "PT3M",
      liveBroadcastContent: "upcoming",
      liveStreamingDetails: { scheduledStartTime: "2026-09-01T00:00:00Z" },
      uploadStatus: "processed",
      code: "not_yet_available",
    },
    {
      name: "송출 중 라이브",
      duration: "PT30M",
      liveBroadcastContent: "live",
      liveStreamingDetails: { actualStartTime: "2026-08-30T00:00:00Z" },
      uploadStatus: "processed",
      code: "not_yet_available",
    },
    {
      name: "처리 중 다시보기",
      duration: "PT30M",
      liveBroadcastContent: "none",
      liveStreamingDetails: {
        actualStartTime: "2026-08-01T00:00:00Z",
        actualEndTime: "2026-08-01T00:30:00Z",
      },
      uploadStatus: "uploaded",
      code: "not_processed",
    },
    {
      name: "종료시간 없는 라이브",
      duration: "PT30M",
      liveBroadcastContent: "none",
      liveStreamingDetails: { actualStartTime: "2026-08-01T00:00:00Z" },
      uploadStatus: "processed",
      code: "not_yet_available",
    },
    {
      name: "시작시간 없는 모순 상태",
      duration: "PT30M",
      liveBroadcastContent: "none",
      liveStreamingDetails: { actualEndTime: "2026-08-01T00:30:00Z" },
      uploadStatus: "processed",
      code: "not_yet_available",
    },
    {
      name: "종료가 시작보다 빠른 모순 상태",
      duration: "PT30M",
      liveBroadcastContent: "none",
      liveStreamingDetails: {
        actualStartTime: "2026-08-01T01:00:00Z",
        actualEndTime: "2026-08-01T00:30:00Z",
      },
      uploadStatus: "processed",
      code: "not_yet_available",
    },
  ])("blocks $name when completed replay support is enabled", async ({
    duration,
    liveBroadcastContent,
    liveStreamingDetails,
    uploadStatus,
    code,
  }) => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "라이브",
          channelTitle: "채널",
          liveBroadcastContent,
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails: { duration },
        status: { uploadStatus, privacyStatus: "public", embeddable: true },
        liveStreamingDetails,
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl(
      "https://youtube.com/live/dQw4w9WgXcQ",
      { allowCompletedLiveReplay: true },
    )).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: code,
    });
  });

  it.each([
    {
      name: "비공개",
      contentDetails: { duration: "PT30M" },
      status: { uploadStatus: "processed", privacyStatus: "private", embeddable: true },
      code: "not_public",
    },
    {
      name: "지역 제한",
      contentDetails: { duration: "PT30M", regionRestriction: { blocked: ["KR"] } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "region_restricted",
    },
    {
      name: "연령 제한",
      contentDetails: { duration: "PT30M", contentRating: { ytRating: "ytAgeRestricted" } },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
      code: "age_restricted",
    },
    {
      name: "저작권 거절",
      contentDetails: { duration: "PT30M" },
      status: {
        uploadStatus: "rejected",
        privacyStatus: "public",
        embeddable: true,
        rejectionReason: "copyright",
      },
      code: "copyright_restricted",
    },
  ])("keeps the existing $name restriction for completed replays", async ({
    contentDetails,
    status,
    code,
  }) => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "제한된 라이브 다시보기",
          channelTitle: "채널",
          liveBroadcastContent: "none",
          thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
        },
        contentDetails,
        status,
        liveStreamingDetails: {
          actualStartTime: "2026-08-01T00:00:00Z",
          actualEndTime: "2026-08-01T00:30:00Z",
        },
      }],
    }), { status: 200 })));

    await expect(analyzeYoutubeUrl(
      "https://youtube.com/live/dQw4w9WgXcQ",
      { allowCompletedLiveReplay: true },
    )).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: code,
    });
  });
});
