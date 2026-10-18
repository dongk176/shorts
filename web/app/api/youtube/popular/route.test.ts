import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  japanReadsEnabled: vi.fn(),
  getPopularVideos: vi.fn(),
  getPopularSearchVideos: vi.fn(),
  getReusablePopularVideos: vi.fn(),
  getBillingSummary: vi.fn(),
  getDb: vi.fn(),
  getCatalogVideos: vi.fn(),
  searchCatalogVideos: vi.fn(),
  getTrendingCalendar: vi.fn(),
  authenticatedSession: vi.fn(),
  hasDirectPopularFilterAccess: vi.fn(),
  managedPopularFilterOverride: vi.fn(),
  recordPopularFilterUsage: vi.fn(),
}));

vi.mock("@/lib/youtube-japan-settings", () => ({ japanReadsEnabled: mocks.japanReadsEnabled }));

vi.mock("@/lib/youtube-popular", () => ({
  getPopularVideos: mocks.getPopularVideos,
  popularVideoTypes: ["trending", "views", "reusable"],
  popularDiscoveryPeriods: ["today", "week", "all"],
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
  managedPopularFilterOverride: mocks.managedPopularFilterOverride,
}));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));

vi.mock("@/lib/youtube-catalog", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/youtube-catalog")>(),
  searchCatalogVideos: mocks.searchCatalogVideos, getCatalogVideos: mocks.getCatalogVideos, getTrendingCalendar: mocks.getTrendingCalendar,
}));
import { CatalogCursorExpiredError } from "@/lib/youtube-catalog";
import { GET as calendarGET } from "./calendar/route";
import { HttpError } from "@/lib/http";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.getDb.mockReturnValue("database");
  mocks.japanReadsEnabled.mockImplementation(async () => process.env.YOUTUBE_JP_DISCOVERY_ENABLED === "true");
  mocks.authenticatedSession.mockResolvedValue({ userId: "user-a" });
  mocks.hasDirectPopularFilterAccess.mockResolvedValue(false);
  mocks.managedPopularFilterOverride.mockResolvedValue(null);
  mocks.recordPopularFilterUsage.mockResolvedValue({ id: "usage-a" });
  mocks.getBillingSummary.mockResolvedValue({
    activeProducts: [{ planCode: "easycut_pro_v2" }],
  });
});

describe("popular YouTube API route", () => {
  it("passes collected periods to the catalog and retains filter authorization", async () => {
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    mocks.getCatalogVideos.mockResolvedValue({ items: [], updatedAt: "", totalCount: 0 });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&reusable=true&period=today&periodBasis=collected"));
    expect(response.status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getCatalogVideos).toHaveBeenCalledWith(expect.objectContaining({type:"trending",reusable:true,period:"today",periodBasis:"collected"}), "database");
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });
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

  it("rejects an unsupported discovery period", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&period=month"));
    expect(response.status).toBe(400);
    expect(mocks.getReusablePopularVideos).not.toHaveBeenCalled();
  });

  it("reads a filtered page from the stored snapshot", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=gaming&reusable=true&longForm=true&korean=true"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getBillingSummary).toHaveBeenCalledWith("database", "user-a");
    expect(mocks.getPopularSearchVideos).toHaveBeenCalledWith("gaming", true, true, true, undefined, 48, "all");
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database", {
      interactionId: undefined,
      userId: "user-a",
      type: "views",
      category: "gaming",
      reusableOnly: true,
      longFormOnly: true,
      japaneseOnly: false,
      englishOnly: false,
      koreanOnly: true,
      discoveryPeriod: "all",
      resultCount: 0,
    });
    await expect(response.json()).resolves.toEqual({ items: [], updatedAt: "2026-07-14T00:00:00.000Z", japaneseEnabled: false });
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
      "all", false, false, undefined, 48, "all",
    );
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });

  it("passes the selected discovery period to the reusable list", async () => {
    mocks.getReusablePopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-28T08:00:00.000Z",
      totalCount: 81,
      periodCounts: { today: 23, week: 81, all: 769 },
    });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=reusable&period=week",
    ));

    expect(response.status).toBe(200);
    expect(mocks.getReusablePopularVideos).toHaveBeenCalledWith(
      "all", false, false, undefined, 48, "week",
    );
    await expect(response.json()).resolves.toMatchObject({
      totalCount: 81,
      periodCounts: { today: 23, week: 81, all: 769 },
    });
  });

  it("passes the selected discovery period to the real-time trending list", async () => {
    mocks.getPopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-28T08:00:00.000Z",
      totalCount: 14,
      periodCounts: { today: 14, week: 72, all: 310 },
    });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=trending&period=today",
    ));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith(
      "trending", "all", false, false, false, undefined, 48, "today",
    );
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith(
      "database",
      expect.objectContaining({ type: "trending", discoveryPeriod: "today" }),
    );
  });

  it("passes the selected discovery period to the most-viewed list", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-28T08:00:00.000Z",
      totalCount: 72,
      periodCounts: { today: 14, week: 72, all: 310 },
    });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=views&period=week",
    ));

    expect(response.status).toBe(200);
    expect(mocks.getPopularSearchVideos).toHaveBeenCalledWith(
      "all", false, false, false, undefined, 48, "week",
    );
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith(
      "database",
      expect.objectContaining({ type: "views", discoveryPeriod: "week" }),
    );
  });

  it("passes only the opaque database cursor when an entitled user loads more", async () => {
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=all&cursor=stored-page-2"));

    expect(response.status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getBillingSummary).toHaveBeenCalledWith("database", "user-a");
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, "stored-page-2", 48, "all");
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).not.toHaveBeenCalled();
  });

  it("falls back to the existing stored chart until the first PRO search snapshot is ready", async () => {
    const unavailable = new (await import("@/lib/youtube-popular-search")).PopularSearchSnapshotUnavailableError();
    mocks.getPopularSearchVideos.mockRejectedValue(unavailable);
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=all"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("views", "all", false, false, false, undefined, 48, "all");
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
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, undefined, 48, "all");
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

  it("requires an active subscription or package for a discovery-period filter", async () => {
    mocks.getBillingSummary.mockResolvedValue({ activeProducts: [] });

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=trending&period=today",
    ));

    expect(response.status).toBe(402);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
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
      japaneseOnly: false,
      englishOnly: false,
      koreanOnly: false,
      discoveryPeriod: "all",
      resultCount: 2,
    });
  });

  it("does not deliver paid results when the usage evidence cannot be stored", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    mocks.recordPopularFilterUsage.mockRejectedValue(
      new Error("POPULAR_FILTER_ENTITLEMENT_SOURCE_MISSING"),
    );

    const response = await GET(new Request(
      "http://localhost/api/youtube/popular?type=views",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      detail: "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(consoleError).toHaveBeenCalledWith("popular_videos_load_failed", {
      errorName: "Error",
      errorCode: "POPULAR_FILTER_ENTITLEMENT_SOURCE_MISSING",
    });
    consoleError.mockRestore();
  });
});

describe("catalog calendar API access", () => {
  beforeEach(() => { vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true"); vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true"); });
  it("records paid date selection without a YouTube request", async () => {
    mocks.getCatalogVideos.mockResolvedValue({items:[],updatedAt:"",date:"2026-08-01"});
    const result=await GET(new Request("http://localhost/api/youtube/popular?type=trending&date=2026-08-01"));
    expect(result.status).toBe(200);expect(mocks.authenticatedSession).toHaveBeenCalled();
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database",expect.objectContaining({selectedDate:"2026-08-01"}));
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });
  it("requires the same paid entitlement for monthly records", async () => {
    mocks.getBillingSummary.mockResolvedValue({activeProducts:[]});
    expect((await calendarGET(new Request("http://localhost/api/youtube/popular/calendar?month=2026-08"))).status).toBe(402);
    expect(mocks.getTrendingCalendar).not.toHaveBeenCalled();
  });
  it("rejects future and impossible dates", async () => {
    for(const date of ["2999-01-01","2026-02-30"]) expect((await GET(new Request(`http://localhost/api/youtube/popular?type=trending&date=${date}`))).status).toBe(400);
    expect(mocks.getCatalogVideos).not.toHaveBeenCalled();
  });
  it("returns an explicit expired cursor response", async () => {
    mocks.getCatalogVideos.mockRejectedValue(new CatalogCursorExpiredError());
    const result=await GET(new Request("http://localhost/api/youtube/popular?type=views&cursor=expired"));
    expect(result.status).toBe(410);expect(await result.json()).toMatchObject({code:"CURSOR_EXPIRED"});
  });
});

describe("Japanese filter API", () => {
  it("never falls through to an unfiltered legacy list when catalog reads are off", async () => {
    mocks.japanReadsEnabled.mockResolvedValue(true);
    const response = await GET(new Request("https://example.com/api/youtube/popular?type=trending&japanese=true"));
    expect(response.status).toBe(503);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });
  it("rejects simultaneous Korean and Japanese filters before reading data", async () => {
    const response = await GET(new Request("https://example.com/api/youtube/popular?type=trending&korean=true&japanese=true"));
    expect(response.status).toBe(400);
    expect(mocks.getCatalogVideos).not.toHaveBeenCalled();
  });
  it("passes the language condition to catalog and usage tracking with existing entitlement checks", async () => {
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true"); vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true"); vi.stubEnv("YOUTUBE_JP_DISCOVERY_ENABLED", "true");
    mocks.getCatalogVideos.mockResolvedValue({ items: [], updatedAt: "" });
    const response = await GET(new Request("https://example.com/api/youtube/popular?type=trending&japanese=true"));
    expect(response.status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalled();
    expect(mocks.getCatalogVideos).toHaveBeenCalledWith(expect.objectContaining({ japanese: true, korean: false }), "database");
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database", expect.objectContaining({ japaneseOnly: true, koreanOnly: false }));
    expect(await response.json()).toMatchObject({ japaneseEnabled: true });
  });
  it("keeps Japanese results disabled by default", async () => {
    const response = await GET(new Request("https://example.com/api/youtube/popular?type=trending&japanese=true"));
    expect(response.status).toBe(503);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });
});


describe("DB-only text search API", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    vi.stubEnv("YOUTUBE_POPULAR_SEARCH_ENABLED", "true");
    mocks.searchCatalogVideos.mockResolvedValue({ items: [], updatedAt: "", totalCount: 0, includesSimilarResults: false });
    mocks.getCatalogVideos.mockResolvedValue({ items: [], updatedAt: "", totalCount: 0 });
  });
  it("authorizes search even with otherwise public default filters and preserves reusable scope", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=reusable&q=%20AI%20"));
    expect(response.status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.searchCatalogVideos).toHaveBeenCalledWith(expect.objectContaining({ q: "ai", reusable: true }), "database");
    expect(mocks.getCatalogVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
    expect((await response.json()).searchEnabled).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([401, 402])("blocks search without access (%s)", async status => {
    if (status === 401) mocks.authenticatedSession.mockRejectedValueOnce(new HttpError(401, "Login required"));
    else mocks.getBillingSummary.mockResolvedValueOnce({ activeProducts: [] });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&q=축구"));
    expect(response.status).toBe(status);
    expect(mocks.searchCatalogVideos).not.toHaveBeenCalled();
  });
  it.each(["a", "a".repeat(101)])("rejects invalid search length", async q => {
    expect((await GET(new Request(`http://localhost/api/youtube/popular?type=trending&q=${q}`))).status).toBe(400);
    expect(mocks.searchCatalogVideos).not.toHaveBeenCalled();
  });
  it("treats whitespace as the unchanged listing, and keeps search disabled until rollout", async () => {
    await GET(new Request("http://localhost/api/youtube/popular?type=trending&q=%20%20"));
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
    expect(mocks.getCatalogVideos).toHaveBeenCalledOnce();
    vi.stubEnv("YOUTUBE_POPULAR_SEARCH_ENABLED", "false");
    expect((await GET(new Request("http://localhost/api/youtube/popular?type=trending&q=축구"))).status).toBe(503);
    expect(mocks.searchCatalogVideos).not.toHaveBeenCalled();
  });
  it("reports DB failure as unavailable, never an empty successful search", async () => {
    mocks.searchCatalogVideos.mockRejectedValueOnce(new Error("DB unavailable"));
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&q=축구"));
    expect(response.status).toBe(503);
  });
});

describe("English popular filter", () => {
  it.each(["english=yes", "english=true&korean=true", "english=true&japanese=true"])("rejects invalid combination %s", async query => {
    expect((await GET(new Request(`http://localhost/api/youtube/popular?type=trending&${query}`))).status).toBe(400);
    expect(mocks.getCatalogVideos).not.toHaveBeenCalled();
  });
  it("fails closed when the catalog is disabled", async () => {
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "false");
    const response=await GET(new Request("http://localhost/api/youtube/popular?type=trending&english=true"));
    expect(response.status).toBe(503);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
  });
  it("authorizes and records English filters, including search and pagination", async () => {
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    vi.stubEnv("YOUTUBE_POPULAR_SEARCH_ENABLED", "true");
    mocks.getCatalogVideos.mockResolvedValue({items:[],updatedAt:"",totalCount:0});
    mocks.searchCatalogVideos.mockResolvedValue({items:[],updatedAt:"",totalCount:0});
    expect((await GET(new Request("http://localhost/api/youtube/popular?type=views&english=true&longForm=true&reusable=true"))).status).toBe(200);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
    expect(mocks.getCatalogVideos).toHaveBeenCalledWith(expect.objectContaining({english:true,korean:false,japanese:false,longForm:true,reusable:true}),"database");
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledWith("database",expect.objectContaining({englishOnly:true}));
    expect((await GET(new Request("http://localhost/api/youtube/popular?type=views&english=true&q=football&cursor=next"))).status).toBe(200);
    expect(mocks.searchCatalogVideos).toHaveBeenCalledWith(expect.objectContaining({english:true,q:"football",cursor:"next"}),"database");
    expect(mocks.recordPopularFilterUsage).toHaveBeenCalledOnce();
  });
});
