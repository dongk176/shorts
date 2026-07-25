import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  analyzeYoutubeUrl: vi.fn(),
  createYoutubeAnalysis: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));
vi.mock("@/lib/youtube", () => ({
  analyzeYoutubeUrl: mocks.analyzeYoutubeUrl,
}));
vi.mock("@/lib/youtube-analysis", () => ({
  createYoutubeAnalysis: mocks.createYoutubeAnalysis,
}));

import { HttpError } from "@/lib/http";
import { POST } from "./route";

const request = () => new Request("http://localhost/api/youtube/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
});

const metadata = {
  videoId: "dQw4w9WgXcQ",
  normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "테스트 영상",
  channelName: "채널",
  channelThumbnailUrl: "https://yt3.ggpht.com/channel-avatar",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 180,
  expectedShortCount: 3,
  creationAllowed: true,
  creationBlockCode: null,
  creationBlockReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-a",
    userId: "user-a",
    user: { id: "auth-a", email: "owner@example.com" },
  });
  mocks.analyzeYoutubeUrl.mockResolvedValue(metadata);
  mocks.createYoutubeAnalysis.mockResolvedValue({
    ...metadata,
    analysisId: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
  });
});

describe("YouTube analysis authentication", () => {
  it("rejects anonymous analysis before calling YouTube", async () => {
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.analyzeYoutubeUrl).not.toHaveBeenCalled();
    expect(mocks.createYoutubeAnalysis).not.toHaveBeenCalled();
  });

  it("analyzes and stores metadata for an authenticated user", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.analyzeYoutubeUrl).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
    expect(mocks.createYoutubeAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a" }),
      metadata,
    );
  });
});
