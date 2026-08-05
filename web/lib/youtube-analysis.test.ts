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
const enabledReleaseFlags = [
  { flagKey: "source_range_selection", enabled: true },
  { flagKey: "source_range_selection_public", enabled: true },
];
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SOURCE_RANGE_SELECTION_ENABLED = "true";
});

describe("YouTube analysis persistence", () => {
  it("stores verified metadata and returns the existing analysis contract", async () => {
    mocks.getDb.mockReturnValue(dbWithRows(
      enabledReleaseFlags,
      [{ id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541" }],
    ));

    const result = await createYoutubeAnalysis(session, metadata);

    expect(result).toEqual({
      ...metadata,
      analysisId: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
      sourceRangeSelectionEnabled: true,
      expectedShortCount: 12,
    });
  });

  it("accepts sources longer than sixty minutes when the release is enabled", async () => {
    mocks.getDb.mockReturnValue(dbWithRows(
      enabledReleaseFlags,
      [{ id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541" }],
    ));
    await expect(
      createYoutubeAnalysis(session, { ...metadata, durationSeconds: 10_800 }),
    ).resolves.toMatchObject({
      durationSeconds: 10_800,
      sourceRangeSelectionEnabled: true,
    });
  });

  it("enables a long source for an administrator before public promotion", async () => {
    const adminSession = { ...session, userId: "admin-user" };
    mocks.getDb.mockReturnValue(dbWithRows(
      [
        { flagKey: "source_range_selection", enabled: true },
        { flagKey: "source_range_selection_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [{ id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541" }],
    ));
    await expect(
      createYoutubeAnalysis(adminSession, { ...metadata, durationSeconds: 10_800 }),
    ).resolves.toMatchObject({ sourceRangeSelectionEnabled: true });
  });

  it("keeps a non-admin on the sixty-minute limit before public promotion", async () => {
    const memberSession = { ...session, userId: "member-user" };
    mocks.getDb.mockReturnValue(dbWithRows(
      [
        { flagKey: "source_range_selection", enabled: true },
        { flagKey: "source_range_selection_public", enabled: false },
      ],
      [{ isAdmin: false }],
    ));
    await expect(
      createYoutubeAnalysis(memberSession, { ...metadata, durationSeconds: 10_800 }),
    ).rejects.toThrow("최대 60분");
  });

  it("keeps three-minute sources on the legacy full-source path", async () => {
    mocks.getDb.mockReturnValue(dbWithRows(
      enabledReleaseFlags,
      [{ id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541" }],
    ));
    await expect(
      createYoutubeAnalysis(session, { ...metadata, durationSeconds: 239 }),
    ).resolves.toMatchObject({ sourceRangeSelectionEnabled: false });
  });

  it("keeps the sixty-minute limit while the release is disabled", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([
      { flagKey: "source_range_selection", enabled: false },
      { flagKey: "source_range_selection_public", enabled: false },
    ]));
    await expect(
      createYoutubeAnalysis(session, { ...metadata, durationSeconds: 3601 }),
    ).rejects.toThrow("최대 60분");
  });

  it("does not persist a source shorter than three minutes", async () => {
    await expect(
      createYoutubeAnalysis(session, { ...metadata, durationSeconds: 179 }),
    ).rejects.toMatchObject({
      status: 400,
      code: "SOURCE_VIDEO_TOO_SHORT",
    });
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
      sourceRangeSelectionEnabled: true,
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
      creationBlockReason: "이 영상은 국가별 시청이 제한된 영상입니다.",
      sourceRangeSelectionEnabled: false,
    }]));

    await expect(getYoutubeAnalysis(session, "6bce83c4-b12e-4d11-8f16-2fef8a96c541")).resolves.toMatchObject({
      creationAllowed: false,
      creationBlockCode: "region_restricted",
    });
  });
});
