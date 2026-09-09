import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
vi.mock("server-only", () => ({}));
import {
  saveCatalogPage,
  getCatalogVideos,
  getTrendingCalendar,
  purgeExpiredCatalog,
  CatalogCursorExpiredError,
  type CatalogVideo,
  type CatalogFilters,
} from "./youtube-catalog";
import {
  collectDiscoveryLane,
  refreshCatalogBatch,
  discoverySearchTasks,
} from "./youtube-discovery-collector";
import {
  backfillCatalogBatch,
  cleanupImportedSnapshots,
  getCatalogBackfillReadiness,
} from "./youtube-catalog-backfill";
import {
  withYoutubePurpose,
  youtubeRequest,
  expandedDiscoveryEnabled,
} from "./youtube-quota";
import { analyzeYoutubeUrl } from "./youtube";
import {
  kstDate,
  discoverySince,
  discoverySlot,
  validKstDate,
  DAY_MS,
} from "./youtube-discovery-time";

const connection = process.env.YOUTUBE_DISCOVERY_TEST_DATABASE_URL;
const integration = connection ? describe : describe.skip;
const fixture = (
  id: string,
  overrides: Partial<CatalogVideo> = {},
): CatalogVideo => ({
  videoId: id,
  title: "영상",
  channelName: "채널",
  thumbnailUrl: "https://example.com/thumb.jpg",
  category: "entertainment",
  durationSeconds: 600,
  viewCount: 100,
  publishedAt: "2026-01-01T00:00:00Z",
  license: "youtube",
  isKorean: true,
  ...overrides,
});
const filters = (extra: Partial<CatalogFilters> = {}): CatalogFilters => ({
  type: "views",
  category: "all",
  reusable: false,
  longForm: false,
  korean: false,
  period: "all",
  ...extra,
});
function youtubeItem(id: string, license = "youtube") {
  return {
    id,
    snippet: {
      title: "영상",
      channelTitle: "채널",
      channelId: "UC123",
      publishedAt: "2026-01-01T00:00:00Z",
      categoryId: "24",
      liveBroadcastContent: "none",
      thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
    },
    contentDetails: { duration: "PT10M" },
    statistics: { viewCount: "100" },
    status: {
      privacyStatus: "public",
      uploadStatus: "processed",
      embeddable: true,
      license,
    },
  };
}

describe("discovery dates and planned query allocation", () => {
  it("uses KST midnight and seven calendar dates", () => {
    expect(kstDate(new Date("2026-08-31T15:00:00Z"))).toBe("2026-09-01");
    expect(
      discoverySince("today", new Date("2026-08-31T15:00:00Z"))?.toISOString(),
    ).toBe("2026-08-31T15:00:00.000Z");
    expect(
      discoverySince("week", new Date("2026-09-01T00:00:00Z"))?.toISOString(),
    ).toBe("2026-08-25T15:00:00.000Z");
    expect(validKstDate("2026-02-30")).toBe(false);
    expect(validKstDate("2999-01-01")).toBe(false);
  });
  it("uses odd KST hours and alternate halves of all 40 queries", () => {
    expect(
      discoverySlot("trending", new Date("2026-09-09T03:10:00Z")).toISOString(),
    ).toBe("2026-09-09T02:00:00.000Z");
    expect(
      discoverySlot("views", new Date("2026-09-09T08:10:00Z")).toISOString(),
    ).toBe("2026-09-09T08:10:00.000Z");
    const am = discoverySearchTasks("views", new Date("2026-09-08T20:10:00Z"));
    const pm = discoverySearchTasks("views", new Date("2026-09-09T08:10:00Z"));
    expect(am).toHaveLength(20);
    expect(pm).toHaveLength(20);
    expect(new Set([...am, ...pm].map((t) => t.key)).size).toBe(40);
    const cc = discoverySearchTasks("reusable", new Date());
    expect(cc.filter((t) => t.continuation)).toHaveLength(7);
    expect(cc.filter((t) => t.source.publishedAfter)).toHaveLength(3);
  });
});

integration("YouTube discovery with isolated PostgreSQL", () => {
  let db: Sql;
  beforeAll(async () => {
    const target = new URL(connection!);
    if (
      !["127.0.0.1", "localhost"].includes(target.hostname) ||
      target.pathname !== "/youtube_discovery_test"
    )
      throw new Error("Isolated local test DB required");
    db = postgres(connection!, {
      max: 12,
      prepare: false,
      connection: { statement_timeout: 10000, lock_timeout: 3000 },
      transform: postgres.camel,
      onnotice: () => {},
    });
    await db.unsafe(`drop schema if exists shorts_mvp cascade; create schema shorts_mvp;
      do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end $$;
      create table shorts_mvp.popular_filter_usage_events(id uuid primary key);
      create table shorts_mvp.youtube_analyses(id uuid primary key,expires_at timestamptz);
      create table shorts_mvp.site_metrics(key text primary key,value bigint,updated_at timestamptz);`);
    const migrationDb = await db.reserve();
    try {
      for (const name of [
        "202607140004_popular_video_snapshots.sql",
        "202607140005_remove_unavailable_popular_categories.sql",
        "202607150006_free_video_snapshots.sql",
        "202607150007_popular_search_snapshots.sql",
        "202607150009_korean_video_filter.sql",
        "202609090001_youtube_discovery_catalog.sql",
      ]) {
        await migrationDb.unsafe(
          readFileSync(path.resolve("../supabase/migrations", name), "utf8"),
        );
      }
    } finally {
      migrationDb.release();
    }
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_QUOTA_PROJECT_ID", "test-project");
    vi.stubEnv("YOUTUBE_API_KEY", "test-api-key");
    await db.unsafe(`truncate shorts_mvp.youtube_catalog,shorts_mvp.youtube_collection_runs,shorts_mvp.youtube_quota_attempts,
      shorts_mvp.youtube_search_positions,shorts_mvp.youtube_list_versions,shorts_mvp.youtube_catalog_imports,shorts_mvp.youtube_quota_verifications,
      shorts_mvp.popular_video_runs,shorts_mvp.popular_search_runs,shorts_mvp.free_video_runs cascade`);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db?.end();
  });
  async function run(at: Date, status = "success", legacy = false) {
    const [r] =
      await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,finished_at,status,legacy) values('trending',${at},${at},${at},${status},${legacy}) returning id`;
    return String(r.id);
  }

  it("builds and reuses a list version for a 50000-video catalog", async () => {
    await db`insert into shorts_mvp.youtube_catalog(id,video_id,metadata,first_discovered_at,verified_at)
      select encode(sha256(convert_to(video_id,'UTF8')),'hex'),video_id,
        ${db.json(fixture("placeholder"))}::jsonb || jsonb_build_object('videoId',video_id,'viewCount',n),now(),now()
      from (select n,'perf'||lpad(n::text,7,'0') as video_id from generate_series(1,50000) n) videos`;
    const started = performance.now();
    const first = await getCatalogVideos(filters(), db);
    const again = await getCatalogVideos(filters(), db);
    console.info(
      "50000-video first page + cached page ms:",
      Math.round(performance.now() - started),
    );
    expect(first.totalCount).toBe(50000);
    expect(first.items).toHaveLength(48);
    expect(first.nextCursor).toBeDefined();
    expect(again.version).toBe(first.version);
  }, 15000);
  it("deduplicates repeat sightings and expires realtime membership without removing the calendar", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 25 * 3_600_000);
    const previous = new Date(now.getTime() - 2 * 3_600_000);
    const oldRun = await run(yesterday);
    const recentRun = await run(previous);
    const currentRun = await run(now);
    await db.begin(async (tx) => {
      await saveCatalogPage(tx, [fixture("oldvideo001")], {
        runId: oldRun,
        trending: true,
        observedAt: yesterday,
      });
      await saveCatalogPage(
        tx,
        [fixture("repeat00001"), fixture("recent00001")],
        { runId: recentRun, trending: true, observedAt: previous },
      );
      await saveCatalogPage(tx, [fixture("repeat00001")], {
        runId: currentRun,
        trending: true,
        observedAt: now,
      });
    });
    const live = await getCatalogVideos(filters({ type: "trending" }), db, now);
    expect(live.items.map((v) => v.videoId)).toEqual([
      "repeat00001",
      "recent00001",
    ]);
    expect(live.items[0].isCurrentTrending).toBe(true);
    expect(live.items[1].isCurrentTrending).toBe(false);
    const historical = await getCatalogVideos(
      filters({ type: "trending", date: kstDate(yesterday) }),
      db,
      now,
    );
    expect(historical.items.some((v) => v.videoId === "oldvideo001")).toBe(
      true,
    );
    const [row] =
      await db`select first_discovered_at from shorts_mvp.youtube_catalog where video_id='repeat00001'`;
    expect(new Date(row.firstDiscoveredAt).toISOString()).toBe(
      previous.toISOString(),
    );
  });
  it("keeps all views, merges free CC, and metadata refresh never changes discovery dates", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 5 * DAY_MS);
    await saveCatalogPage(
      db,
      [
        fixture("standard001"),
        fixture("freecc00001", { license: "creativeCommon" }),
      ],
      { observedAt: old },
    );
    await saveCatalogPage(db, [fixture("standard001", { viewCount: 999 })], {
      observedAt: now,
    });
    expect(
      (await getCatalogVideos(filters({ period: "today" }), db, now)).items,
    ).toHaveLength(0);
    expect(
      (await getCatalogVideos(filters(), db, now)).items.map((v) => v.videoId),
    ).toEqual(["standard001"]);
    expect(
      (
        await getCatalogVideos(filters({ type: "reusable" }), db, now)
      ).items.map((v) => v.videoId),
    ).toEqual(["freecc00001"]);
    const [row] =
      await db`select last_trending_at from shorts_mvp.youtube_catalog where video_id='standard001'`;
    expect(row.lastTrendingAt).toBeNull();
  });
  it("holds pagination order while honoring current licenses and availability", async () => {
    const now = new Date();
    const videos = Array.from({ length: 100 }, (_, i) =>
      fixture(`page${String(i).padStart(7, "0")}`, { viewCount: 1000 - i }),
    );
    await saveCatalogPage(db, videos, { observedAt: now });
    const first = await getCatalogVideos(filters(), db, now);
    await saveCatalogPage(
      db,
      [
        fixture("page0000060", { viewCount: 10000 }),
        fixture("page0000050", { license: "creativeCommon" }),
      ],
      { observedAt: new Date(now.getTime() + 1000) },
    );
    const second = await getCatalogVideos(
      filters({ cursor: first.nextCursor }),
      db,
      now,
    );
    expect(second.items[0].videoId).toBe("page0000048");
    expect(second.items.map((v) => v.videoId)).not.toContain("page0000050");
    expect(
      second.items.find((v) => v.videoId === "page0000060")?.viewCount,
    ).toBe(10000);
    expect(
      new Set([...first.items, ...second.items].map((v) => v.videoId)).size,
    ).toBe(96);
    await db`update shorts_mvp.youtube_list_versions set expires_at=${new Date(now.getTime() - 1)}`;
    await expect(
      getCatalogVideos(filters({ cursor: first.nextCursor }), db, now),
    ).rejects.toBeInstanceOf(CatalogCursorExpiredError);
  });
  it("represents legacy daily history, missing and partial days across month end", async () => {
    await run(new Date("2026-08-30T08:00:00Z"), "success", true);
    await run(new Date("2026-08-31T08:00:00Z"), "partial");
    const calendar = await getTrendingCalendar(
      "2026-08",
      db,
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(calendar.days.find((d) => d.date === "2026-08-30")).toMatchObject({
      collections: 1,
      legacy: true,
      status: "complete",
    });
    expect(calendar.days.find((d) => d.date === "2026-08-31")?.status).toBe(
      "partial",
    );
    expect(calendar.days[0].status).toBe("none");
  });
  it("enforces search 40+20+30 atomically across concurrent requests and counts failed dispatches", async () => {
    const fake = vi.fn(async () => new Response("{}", { status: 503 }));
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    const calls = ["views", "reusable", "free"].flatMap((purpose) =>
      Array.from({ length: 50 }, () =>
        withYoutubePurpose(purpose as "views" | "reusable" | "free", db, () =>
          youtubeRequest("free", url, {}, fake),
        ),
      ),
    );
    const settled = await Promise.allSettled(calls);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(90);
    expect(fake).toHaveBeenCalledTimes(90);
    const rows =
      await db`select purpose,count(*)::int as count from shorts_mvp.youtube_quota_attempts group by purpose order by purpose`;
    expect(rows.map((r) => [r.purpose, r.count])).toEqual([
      ["free", 30],
      ["reusable", 20],
      ["views", 40],
    ]);
    const [timezone] =
      await db`select bool_and(quota_day=(attempted_at at time zone 'America/Los_Angeles')::date) as correct from shorts_mvp.youtube_quota_attempts`;
    expect(timezone.correct).toBe(true);
  });
  it("reserves 6000 general units for foreground and stops at 9000 total", async () => {
    await db`insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units) values('test-project',(now() at time zone 'America/Los_Angeles')::date,'general','refresh',2999)`;
    const request = (purpose: "analysis" | "refresh") =>
      withYoutubePurpose(purpose, db, () =>
        youtubeRequest(
          purpose,
          new URL("https://www.googleapis.com/youtube/v3/videos"),
          {},
          async () => new Response("{}"),
        ),
      );
    expect(
      (
        await Promise.allSettled(
          Array.from({ length: 8 }, () => request("refresh")),
        )
      ).filter((r) => r.status === "fulfilled"),
    ).toHaveLength(1);
    await db`insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units) values('test-project',(now() at time zone 'America/Los_Angeles')::date,'general','analysis',5999)`;
    expect(
      (
        await Promise.allSettled(
          Array.from({ length: 8 }, () => request("analysis")),
        )
      ).filter((r) => r.status === "fulfilled"),
    ).toHaveLength(1);
  });
  it("claims one scheduled run even with concurrent triggers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [youtubeItem("samevideo01")] })),
    );
    const scheduledAt = new Date();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        collectDiscoveryLane("trending", { db, fetchImpl, scheduledAt }),
      ),
    );
    expect(results.filter((r) => r.skipped)).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    const [count] =
      await db`select count(*)::int as count from shorts_mvp.youtube_trending_days`;
    expect(count.count).toBe(1);
  });
  it("persists successful pages and resumes CC tokens only on the next run", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search"))
        return new Response(
          JSON.stringify({
            items: [{ id: { videoId: "ccvideo0001" } }],
            nextPageToken: "next-token",
          }),
        );
      return new Response(
        JSON.stringify({
          items: [youtubeItem("ccvideo0001", "creativeCommon")],
        }),
      );
    });
    const time = new Date();
    await collectDiscoveryLane("reusable", {
      db,
      fetchImpl,
      scheduledAt: time,
    });
    const [positions] =
      await db`select count(*)::int as count from shorts_mvp.youtube_search_positions where page_token='next-token'`;
    expect(positions.count).toBe(7);
    fetchImpl.mockClear();
    await collectDiscoveryLane("reusable", {
      db,
      fetchImpl,
      scheduledAt: new Date(time.getTime() + 12 * 3_600_000),
    });
    const searches = fetchImpl.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((u) => u.pathname.endsWith("/search"));
    expect(
      searches.filter((u) => u.searchParams.get("pageToken") === "next-token"),
    ).toHaveLength(7);
  });
  it("does not delete metadata on transport or malformed responses, but removes definitive unavailable videos", async () => {
    const now = new Date();
    await saveCatalogPage(db, [fixture("refresh0001")], { observedAt: now });
    const due = () =>
      db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    await due();
    await refreshCatalogBatch({
      db,
      scheduledAt: new Date(now.getTime() - 60_000),
      fetchImpl: async () => {
        throw new Error("network");
      },
    });
    expect(
      (await db`select metadata from shorts_mvp.youtube_catalog`)[0].metadata,
    ).not.toBeNull();
    await due();
    await refreshCatalogBatch({
      db,
      scheduledAt: new Date(now.getTime() - 30_000),
      fetchImpl: async () => new Response("{}"),
    });
    expect(
      (await db`select metadata from shorts_mvp.youtube_catalog`)[0].metadata,
    ).not.toBeNull();
    await due();
    await refreshCatalogBatch({
      db,
      scheduledAt: now,
      fetchImpl: async () => new Response('{"items":[]}'),
    });
    expect(
      (
        await db`select metadata,availability from shorts_mvp.youtube_catalog`
      )[0],
    ).toMatchObject({ metadata: null, availability: "unavailable" });
  });
  it("invalidates expired CC tokens without searching again in the same run", async () => {
    const scheduledAt = new Date();
    for (const task of discoverySearchTasks("reusable", scheduledAt).filter(
      (task) => task.continuation,
    )) {
      await db`insert into shorts_mvp.youtube_search_positions(source_key,conditions,page_token) values(${task.key},
        ${db.json({ query: null, videoCategoryId: task.source.videoCategoryId!, publishedAfter: null, videoLicense: "creativeCommon" })},'expired')`;
    }
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: "invalidPageToken" }] },
          }),
          { status: 400 },
        ),
    );
    const result = await collectDiscoveryLane("reusable", {
      db,
      fetchImpl,
      scheduledAt,
    });
    expect(result.failed).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(
      (
        await db`select count(*)::int as count from shorts_mvp.youtube_search_positions where page_token is not null`
      )[0].count,
    ).toBe(0);
  });
  it("keeps good pages and previous videos when a trending category fails", async () => {
    const before = new Date(Date.now() - 2 * 3_600_000);
    const previous = await run(before);
    await saveCatalogPage(db, [fixture("previous001")], {
      runId: previous,
      trending: true,
      observedAt: before,
    });
    const fetchImpl = async (input: RequestInfo | URL) =>
      new URL(String(input)).searchParams.get("videoCategoryId") === "20"
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ items: [youtubeItem("partial0001")] }));
    const result = await collectDiscoveryLane("trending", {
      db,
      fetchImpl,
      scheduledAt: new Date(),
    });
    expect(result.failed).toBe(1);
    const live = await getCatalogVideos(filters({ type: "trending" }), db);
    expect(new Set(live.items.map((v) => v.videoId))).toEqual(
      new Set(["previous001", "partial0001"]),
    );
    expect(
      (
        await db`select status,page_count from shorts_mvp.youtube_collection_runs where id=${result.runId!}`
      )[0],
    ).toMatchObject({ status: "partial", pageCount: 6 });
  });
  it("purges all stale API fields after 30 days while retaining unidentifiable calendar membership", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * DAY_MS);
    await saveCatalogPage(db, [fixture("expired0001")], {
      observedAt: old,
      trending: true,
    });
    await purgeExpiredCatalog(db, now);
    const [row] =
      await db`select video_id,metadata,availability from shorts_mvp.youtube_catalog`;
    expect(row).toMatchObject({
      videoId: null,
      metadata: null,
      availability: "expired",
    });
    const day = (
      await getTrendingCalendar(kstDate(old).slice(0, 7), db, now)
    ).days.find((d) => d.date === kstDate(old));
    expect(day?.unavailableCount).toBe(1);
  });
  it("meters original analysis as two general units", async () => {
    const verifiedAt = new Date(Date.now() - DAY_MS);
    await saveCatalogPage(
      db,
      [fixture("dQw4w9WgXcQ", { license: "creativeCommon" })],
      { observedAt: verifiedAt },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify(
              String(input).includes("/channels")
                ? {
                    items: [
                      {
                        snippet: {
                          thumbnails: {
                            default: { url: "https://example.com/channel.jpg" },
                          },
                        },
                      },
                    ],
                  }
                : { items: [youtubeItem("dQw4w9WgXcQ")] },
            ),
          ),
      ),
    );
    await withYoutubePurpose("analysis", db, () =>
      analyzeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
    );
    const [usage] =
      await db`select sum(units)::int as units from shorts_mvp.youtube_quota_attempts where purpose='analysis' and bucket='general'`;
    expect(usage.units).toBe(2);
    const [video] =
      await db`select metadata,verified_at from shorts_mvp.youtube_catalog where video_id='dQw4w9WgXcQ'`;
    expect(video.metadata.license).toBe("youtube");
    expect(new Date(video.verifiedAt).toISOString()).toBe(
      verifiedAt.toISOString(),
    );
  });
  it("keeps expanded scheduling off until project, key, quotas and backfill are verified", async () => {
    vi.stubEnv("YOUTUBE_DISCOVERY_EXPANDED", "true");
    expect(await expandedDiscoveryEnabled(db)).toBe(false);
    await db`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,other_clients_reviewed,verified_at,evidence,expanded_at,backfill_verified_at)
      values('test-project','wrong-key',100,10000,true,now(),'mock test evidence',now(),now())`;
    expect(await expandedDiscoveryEnabled(db)).toBe(false);
  });
  it("backfills old days honestly and rechecks stale metadata before storing it", async () => {
    const old = new Date(Date.now() - 35 * DAY_MS);
    const id = randomUUID();
    await db`insert into shorts_mvp.popular_video_runs(id,snapshot_date,status,started_at,completed_at,page_count,item_count) values(${id},${kstDate(old)},'ready',${old},${old},1,1)`;
    await db`insert into shorts_mvp.popular_video_items(run_id,video_id,category,category_rank,page_number,title,channel_name,thumbnail_url,duration_seconds,view_count,published_at,license,is_korean,collected_at)
      values(${id},'legacy00001','entertainment',1,1,'Old title','channel','https://example.com/old.jpg',600,1,${old},'youtube',true,${old})`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [youtubeItem("legacy00001")] })),
    );
    expect(await backfillCatalogBatch(db, fetchImpl)).toMatchObject({
      processed: 1,
    });
    expect(await backfillCatalogBatch(db, fetchImpl)).toMatchObject({
      done: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getCatalogBackfillReadiness(db)).toMatchObject({
      ready: true,
      pendingRuns: 0,
      missingVideos: 0,
      missingDays: 0,
    });
    const [row] =
      await db`select metadata,first_discovered_at from shorts_mvp.youtube_catalog`;
    expect(row.metadata.title).toBe("영상");
    expect(new Date(row.firstDiscoveredAt).toISOString()).toBe(
      old.toISOString(),
    );
    await db`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,verified_at,evidence,backfill_verified_at)
      values('test-project','test-only',100,10000,now(),'integration comparison passed',now())`;
    await cleanupImportedSnapshots(db);
    expect(
      (
        await db`select count(*)::int as count from shorts_mvp.popular_video_items`
      )[0].count,
    ).toBe(0);
    expect(
      (await getTrendingCalendar(kstDate(old).slice(0, 7), db)).days.find(
        (d) => d.date === kstDate(old),
      ),
    ).toMatchObject({ collections: 1, legacy: true });
  });
});
