import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getStoredPopularVideo: vi.fn(),
  getStoredPopularSearchVideo: vi.fn(),
  getStoredFreeVideo: vi.fn(),
  analyzeYoutubeUrl: vi.fn(),
  createYoutubeAnalysis: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireMvpSession: mocks.session }));
vi.mock("@/lib/youtube-analysis", () => ({ createYoutubeAnalysis: mocks.createYoutubeAnalysis }));
vi.mock("@/lib/youtube-free", () => ({ getStoredFreeVideo: mocks.getStoredFreeVideo }));
vi.mock("@/lib/youtube-popular", () => ({ getStoredPopularVideo: mocks.getStoredPopularVideo }));
vi.mock("@/lib/youtube-popular-search", () => ({
  getStoredPopularSearchVideo: mocks.getStoredPopularSearchVideo,
}));
vi.mock("@/lib/youtube", () => ({ analyzeYoutubeUrl: mocks.analyzeYoutubeUrl }));

import { POST } from "./route";

const video = {
  videoId: "dQw4w9WgXcQ",
  category: "gaming",
  title: "인기 영상",
  channelName: "인기 채널",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 1800,
  viewCount: 1_000_000,
  publishedAt: "2026-07-14T00:00:00.000Z",
  license: "youtube",
};
const verifiedMetadata = {
  videoId: video.videoId,
  normalizedUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
  title: video.title,
  channelName: video.channelName,
  channelThumbnailUrl: "https://yt3.ggpht.com/channel-avatar",
  thumbnailUrl: video.thumbnailUrl,
  durationSeconds: video.durationSeconds,
  expectedShortCount: 12,
  creationAllowed: true,
  creationBlockCode: null,
  creationBlockReason: null,
};

function request(body: unknown) {
  return new Request("http://localhost/api/youtube/popular/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session-a", selectedPlanCode: "pro", userId: null });
  mocks.getStoredPopularVideo.mockResolvedValue(video);
  mocks.getStoredPopularSearchVideo.mockResolvedValue(null);
  mocks.getStoredFreeVideo.mockResolvedValue(null);
  mocks.analyzeYoutubeUrl.mockResolvedValue(verifiedMetadata);
  mocks.createYoutubeAnalysis.mockResolvedValue({ analysisId: "6bce83c4-b12e-4d11-8f16-2fef8a96c541", ...video });
});

describe("popular video shorts preparation", () => {
  it("rechecks current YouTube availability before creating an analysis", async () => {
    const response = await POST(request({ videoId: video.videoId, source: "pro" }));

    expect(response.status).toBe(201);
    expect(mocks.getStoredPopularVideo).toHaveBeenCalledWith(video.videoId);
    expect(mocks.analyzeYoutubeUrl).toHaveBeenCalledWith(
      `https://www.youtube.com/watch?v=${video.videoId}`,
    );
    expect(mocks.createYoutubeAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-a" }),
      verifiedMetadata,
    );
  });

  it("rejects a video that is not in a ready stored snapshot", async () => {
    mocks.getStoredPopularVideo.mockResolvedValue(null);
    mocks.getStoredPopularSearchVideo.mockResolvedValue(null);
    mocks.getStoredFreeVideo.mockResolvedValue(null);

    const response = await POST(request({ videoId: video.videoId, source: "pro" }));

    expect(response.status).toBe(404);
    expect(mocks.createYoutubeAnalysis).not.toHaveBeenCalled();
  });

  it("accepts a video stored only in the free snapshot", async () => {
    mocks.getStoredPopularVideo.mockResolvedValue(null);
    mocks.getStoredPopularSearchVideo.mockResolvedValue(null);
    mocks.getStoredFreeVideo.mockResolvedValue(video);

    const response = await POST(request({ videoId: video.videoId, source: "free" }));

    expect(response.status).toBe(201);
    expect(mocks.getStoredFreeVideo).toHaveBeenCalledWith(video.videoId);
    expect(mocks.createYoutubeAnalysis).toHaveBeenCalledTimes(1);
  });

  it("accepts a video stored only in the PRO view-count snapshot", async () => {
    mocks.getStoredPopularVideo.mockResolvedValue(null);
    mocks.getStoredPopularSearchVideo.mockResolvedValue(video);

    const response = await POST(request({ videoId: video.videoId, source: "pro" }));

    expect(response.status).toBe(201);
    expect(mocks.getStoredPopularSearchVideo).toHaveBeenCalledWith(video.videoId);
    expect(mocks.getStoredFreeVideo).not.toHaveBeenCalled();
  });

  it("rejects malformed video IDs before reading stored data", async () => {
    const response = await POST(request({ videoId: "bad" }));

    expect(response.status).toBe(400);
    expect(mocks.getStoredPopularVideo).not.toHaveBeenCalled();
    expect(mocks.getStoredPopularSearchVideo).not.toHaveBeenCalled();
  });

  it("allows a non-Pro session to prepare a video from the visible preview", async () => {
    mocks.session.mockResolvedValue({ id: "session-a", selectedPlanCode: "standard", userId: "user-a" });

    const response = await POST(request({ videoId: video.videoId, source: "pro" }));

    expect(response.status).toBe(201);
    expect(mocks.getStoredPopularVideo).toHaveBeenCalledWith(video.videoId);
    expect(mocks.getStoredFreeVideo).not.toHaveBeenCalled();
  });
});
