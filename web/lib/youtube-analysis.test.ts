import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { createYoutubeAnalysis, getYoutubeAnalysis } from "./youtube-analysis";

function dbWithRows(...responses: unknown[][]) {
  const tag = vi.fn();
  for (const response of responses) tag.mockResolvedValueOnce(response);
  return tag;
}

const session = { id: "session-a", userId: null, user: null, selectedPlanCode: "plus" };
const metadata = {
  videoId: "dQw4w9WgXcQ",
  normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "인기 영상",
  channelName: "인기 채널",
  channelThumbnailUrl: "https://yt3.ggpht.com/channel-avatar",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 1800,
  creationAllowed: true,
  creationBlockCode: null,
  creationBlockReason: null,
};

beforeEach(() => vi.clearAllMocks());

describe("YouTube analysis persistence", () => {
  it("stores verified metadata and returns the existing analysis contract", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{ id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541" }]));

    const result = await createYoutubeAnalysis(session, metadata);

    expect(result).toEqual({
      ...metadata,
      analysisId: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
      expectedShortCount: 12,
    });
  });

  it("preserves the sixty-minute input limit", async () => {
    await expect(createYoutubeAnalysis(session, { ...metadata, durationSeconds: 3601 })).rejects.toThrow("최대 60분");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("loads only a valid session-scoped analysis", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{
      id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
      youtubeUrl: metadata.normalizedUrl,
      youtubeVideoId: metadata.videoId,
      videoTitle: metadata.title,
      channelName: metadata.channelName,
      channelThumbnailUrl: metadata.channelThumbnailUrl,
      thumbnailUrl: metadata.thumbnailUrl,
      durationSeconds: metadata.durationSeconds,
      creationAllowed: metadata.creationAllowed,
      creationBlockCode: metadata.creationBlockCode,
      creationBlockReason: metadata.creationBlockReason,
    }]));

    await expect(getYoutubeAnalysis(session, "6bce83c4-b12e-4d11-8f16-2fef8a96c541")).resolves.toMatchObject({
      videoId: metadata.videoId,
      durationSeconds: metadata.durationSeconds,
      creationAllowed: true,
    });
  });

  it("loads a persisted creation block reason", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{
      id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
      youtubeUrl: metadata.normalizedUrl,
      youtubeVideoId: metadata.videoId,
      videoTitle: metadata.title,
      channelName: metadata.channelName,
      channelThumbnailUrl: null,
      thumbnailUrl: metadata.thumbnailUrl,
      durationSeconds: metadata.durationSeconds,
      creationAllowed: false,
      creationBlockCode: "region_restricted",
      creationBlockReason: "국가별 시청 제한이 있는 영상은 쇼츠로 만들 수 없습니다.",
    }]));

    await expect(getYoutubeAnalysis(session, "6bce83c4-b12e-4d11-8f16-2fef8a96c541")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "region_restricted",
    });
  });
});
