import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPopularVideos: vi.fn(),
  getPopularSearchVideos: vi.fn(),
  getReusablePopularVideos: vi.fn(),
  getBillingSummary: vi.fn(),
  getDb: vi.fn(),
  authenticatedSession: vi.fn(),
  hasDirectPopularFilterAccess: vi.fn(),
  recordPopularFilterUsage: vi.fn(),
}));

vi.mock("@/lib/youtube-popular", () => ({
  getPopularVideos: mocks.getPopularVideos,
  popularVideoTypes: ["trending", "views", "reusable"],
  popularVideoCategories: ["all", "entertainment", "gaming", "sports", "music", "news", "science", "howto"],
  PopularSnapshotUnavailableError: class PopularSnapshotUnavailableError extends Error {},
}));

vi.mock("@/lib/youtube-popular-search", () => ({
  getPopularSearchVideos: mocks.getPopularSearchVideos,
  getReusablePopularVideos: mocks.getReusablePopularVideos,
  PopularSearchSnapshotUnavailableError: class PopularSearchSnapshotUnavailableError extends Error {},
}));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.getBillingSummary }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/popular-filter-usage", () => ({
  recordPopularFilterUsage: mocks.recordPopularFilterUsage,
}));
vi.mock("@/lib/popular-entitlements", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/popular-entitlements")>(),
  hasDirectPopularFilterAccess: mocks.hasDirectPopularFilterAccess,
}));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));

import { HttpError } from "@/lib/http";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue("database");
  mocks.authenticatedSession.mockResolvedValue({ userId: "user-a" });
  mocks.hasDirectPopularFilterAccess.mockResolvedValue(false);
  mocks.recordPopularFilterUsage.mockResolvedValue({ id: "usage-a" });
  mocks.getBillingSummary.mockResolvedValue({
    activeProducts: [{ planCode: "easycut_pro_v2" }],
  });
});

describe("popular YouTube API route", () => {
  it("rejects unsupported filters before reading the database", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=unknown"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects an unsupported category before reading the database", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=unknown"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects malformed long-form filter values", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&longForm=yes"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects malformed Korean-language filter values", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&korean=yes"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("reads a filtered page from the stored snapshot", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=gaming&reusable=true&longForm=true&korean=true"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getBillingSummary).toHaveBeenCalledWith("database", "user-a");
    expect(mocks.getPopularSearchVideos).toHaveBeenCalledWith("gaming", true, true, true, undefined, 48);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database", {
      interactionId: undefined,
      userId: "user-a",
      type: "views",
      category: "gaming",
      reusableOnly: true,
      longFormOnly: true,
      koreanOnly: true,
      resultCount: 0,
    });
    await expect(response.json()).resolves.toEqual({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
  });

  it("maps the reusable primary filter to the accumulated view-count list", async () => {
    mocks.getReusablePopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-25T08:00:00.000Z",
    });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=reusable&category=all",
    ));

    expect(response.status).toBe(200);
    expect(mocks.getReusablePopularVideos).toHaveBeenCalledWith(
      "all", false, false, undefined, 48,
    );
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });

  it("passes only the opaque database cursor when an entitled user loads more", async () => {
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=all&cursor=stored-page-2"));

    expect(response.status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getBillingSummary).toHaveBeenCalledWith("database", "user-a");
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, "stored-page-2", 48);
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).not.toHaveBeenCalled();
  });

  it("falls back to the existing stored chart until the first PRO search snapshot is ready", async () => {
    const unavailable = new (await import("@/lib/youtube-popular-search")).PopularSearchSnapshotUnavailableError();
    mocks.getPopularSearchVideos.mockRejectedValue(unavailable);
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=all"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("views", "all", false, false, false, undefined, 48);
  });

  it("returns a safe service error", async () => {
    mocks.getPopularSearchVideos.mockRejectedValue(new Error("secret database detail"));
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&reusable=false"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ detail: "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
  });

  it("returns the same first page size for every plan", async () => {
    mocks.getPopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-14T00:00:00.000Z",
      nextCursor: "preview-page-2",
    });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, undefined, 48);
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("requires login before default-list pagination", async () => {
    mocks.authenticatedSession.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&cursor=preview-page-2"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      detail: "로그인이 필요합니다.",
    });
    expect(mocks.recordPopularFilterUsage).not.toHaveBeenCalled();
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });

  it("requires an active subscription or package before default-list pagination", async () => {
    mocks.getBillingSummary.mockResolvedValue({ activeProducts: [] });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&cursor=preview-page-2"));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "POPULAR_FILTER_PLAN_REQUIRED",
    });
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });

  it("requires login before using an advanced filter", async () => {
    mocks.authenticatedSession.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=gaming&reusable=true&longForm=true"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      detail: "로그인이 필요합니다.",
    });
    expect(mocks.getBillingSummary).not.toHaveBeenCalled();
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });

  it("requires an active subscription or package for advanced filters", async () => {
    mocks.getBillingSummary.mockResolvedValue({ activeProducts: [] });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&korean=true"));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "POPULAR_FILTER_PLAN_REQUIRED",
      detail: "실시간 인기 필터는 활성 구독 또는 기간 패키지를 이용할 때 사용할 수 있습니다.",
    });
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).not.toHaveBeenCalled();
  });

  it("allows advanced filters with direct time-limited access", async () => {
    mocks.getBillingSummary.mockResolvedValue({ activeProducts: [] });
    mocks.hasDirectPopularFilterAccess.mockResolvedValue(true);
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=views&korean=true",
    ));

    expect(response.status).toBe(200);
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledOnce();
  });

  it("records a client interaction id once the paid results are ready", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [{ videoId: "video-a" }, { videoId: "video-b" }],
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    const interactionId = "7d85357e-68d4-45fe-846d-b9988eb66374";

    const response = await GET(new Request(
      `http://localhost/api/youtube/popular?type=views&interactionId=${interactionId}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database", {
      interactionId,
      userId: "user-a",
      type: "views",
      category: "all",
      reusableOnly: false,
      longFormOnly: false,
      koreanOnly: false,
      resultCount: 2,
    });
  });

  it("does not deliver paid results when the usage evidence cannot be stored", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    mocks.recordPopularFilterUsage.mockRejectedValue(new Error("audit unavailable"));

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=views",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      detail: "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});
