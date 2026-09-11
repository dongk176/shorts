import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  getCatalogVisibility,
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
import { collectFreeVideos } from "./youtube-free";
import { refreshCatalogViewCounter } from "./reusable-view-counter-server";
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
        "202609110001_youtube_quota_opening_balances.sql",
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
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    vi.stubEnv("YOUTUBE_QUOTA_PROJECT_ID", "test-project");
    vi.stubEnv("YOUTUBE_API_KEY", "test-api-key");
    await db.unsafe(`truncate shorts_mvp.youtube_catalog,shorts_mvp.youtube_collection_runs,shorts_mvp.youtube_quota_attempts,
      shorts_mvp.youtube_search_positions,shorts_mvp.youtube_list_versions,shorts_mvp.youtube_catalog_imports,shorts_mvp.youtube_quota_verifications,
      shorts_mvp.popular_video_runs,shorts_mvp.popular_search_runs,shorts_mvp.free_video_runs cascade`);
    await db`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,verified_at,evidence,accounting_ready_from)
      values('test-project','test',100,10000,now(),'isolated fixture',(now() at time zone 'America/Los_Angeles')::date)`;
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

  async function legacyVideo(id: string, at: Date) {
    const runId = randomUUID();
    await db`insert into shorts_mvp.popular_video_runs(id,snapshot_date,status,started_at,completed_at,page_count,item_count)
      values(${runId},${kstDate(at)},'ready',${at},${at},1,1)`;
    await db`insert into shorts_mvp.popular_video_items(run_id,video_id,category,category_rank,page_number,title,channel_name,thumbnail_url,duration_seconds,view_count,published_at,license,is_korean,collected_at)
      values(${runId},${id},'entertainment',1,1,'Old snapshot','channel','https://example.com/old.jpg',600,1,${at},'youtube',true,${at})`;
    return runId;
  }

  it("does not replace the live legacy counter with an incomplete backfill", async () => {
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "false");
    await db`insert into shorts_mvp.site_metrics(key,value,updated_at) values('reusable_views_target',12345,now()) on conflict(key) do update set value=12345`;
    await saveCatalogPage(db,[fixture('counter0001',{license:'creativeCommon',viewCount:500})],{observedAt:new Date()});
    await refreshCatalogViewCounter(db,new Date());
    expect((await db`select value from shorts_mvp.site_metrics where key='reusable_views_target'`)[0].value).toBe('12345');
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    await refreshCatalogViewCounter(db,new Date());
    expect((await db`select value from shorts_mvp.site_metrics where key='reusable_views_target'`)[0].value).toBe('500');
  });

  it("adds opening balances atomically without fabricating requests or counting a replayed setup twice", async () => {
    for (const [purpose, units] of [["views",38],["reusable",20],["free",30]] as const) {
      for (let retry=0;retry<2;retry++) await db`insert into shorts_mvp.youtube_quota_opening_balances(project_id,quota_day,bucket,purpose,units,observed_through,evidence)
        values('test-project',(now() at time zone 'America/Los_Angeles')::date,'search',${purpose},${units},now(),'observed usage')
        on conflict(project_id,quota_day,bucket,purpose) do update set units=greatest(youtube_quota_opening_balances.units,excluded.units)`;
    }
    const calls=await Promise.all(Array.from({length:20},()=>db`select shorts_mvp.reserve_youtube_quota('test-project','search','views',1) as id`));
    expect(calls.filter(rows=>rows[0].id)).toHaveLength(2);
    expect((await db`select count(*)::int as n from shorts_mvp.youtube_quota_attempts`)[0].n).toBe(2);
    await expect(db`update shorts_mvp.youtube_quota_opening_balances set units=0 where purpose='views'`).rejects.toThrow('YOUTUBE_OPENING_BALANCE_CANNOT_DECREASE');
  });

  it("counts general opening usage against background and total limits, but ignores another PT day", async () => {
    await db`insert into shorts_mvp.youtube_quota_opening_balances(project_id,quota_day,bucket,purpose,units,observed_through,evidence)
      values('test-project',(now() at time zone 'America/Los_Angeles')::date,'general','refresh',2999,now(),'background'),
      ('test-project',(now() at time zone 'America/Los_Angeles')::date,'general','analysis',5999,now(),'foreground'),
      ('test-project',(now() at time zone 'America/Los_Angeles')::date-1,'general','analysis',9000,now()-interval '1 day','previous day')`;
    const calls=await Promise.all(Array.from({length:10},()=>db`select shorts_mvp.reserve_youtube_quota('test-project','general','refresh',1) as id`));
    expect(calls.filter(rows=>rows[0].id)).toHaveLength(1);
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) as id`)[0].id).toBeTruthy();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) as id`)[0].id).toBeNull();
  });

  it("blocks background reservations until prior usage is reconciled", async () => {
    await db`update shorts_mvp.youtube_quota_verifications set accounting_ready_from=null`;
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','refresh',1) as id`)[0].id).toBeNull();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) as id`)[0].id).toBeTruthy();
  });

  it("preserves completed replays and original discovery dates through import and refresh", async () => {
    const ids=["jDPal12pVno","xgBS4yDSNV0","wKjpYOR8_F0"];
    const old=new Date(Date.now()-35*DAY_MS);
    for(let i=0;i<ids.length;i++) await legacyVideo(ids[i],new Date(old.getTime()+i*1000));
    const fetchImpl=vi.fn<typeof fetch>(async input=>{
      const requested=new URL(String(input)).searchParams.get('id')!.split(',');
      return new Response(JSON.stringify({items:requested.map(id=>({...youtubeItem(id,'creativeCommon'),liveStreamingDetails:{actualStartTime:'2026-08-01T00:00:00Z',actualEndTime:'2026-08-01T00:30:00Z'}}))}));
    });
    for(let i=0;i<3;i++) await backfillCatalogBatch(db,fetchImpl);
    expect(await getCatalogBackfillReadiness(db)).toMatchObject({ready:true});
    const before=await db`select id,first_discovered_at,last_trending_at from shorts_mvp.youtube_catalog order by id`;
    await db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    expect(await refreshCatalogBatch({db,fetchImpl})).toMatchObject({failed:false,pages:1});
    expect(await db`select id,first_discovered_at,last_trending_at from shorts_mvp.youtube_catalog order by id`).toEqual(before);
    expect((await getCatalogVideos(filters({type:'reusable'}),db)).totalCount).toBe(3);
    await db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    const incomplete=async()=>new Response(JSON.stringify({items:[{...youtubeItem(ids[0]),liveStreamingDetails:{actualStartTime:'2026-08-01T00:00:00Z'}}]}));
    expect(await refreshCatalogBatch({db,fetchImpl:incomplete,scheduledAt:new Date(Date.now()+900000)})).toMatchObject({failed:true});
    expect((await db`select count(*)::int n from shorts_mvp.youtube_catalog where availability='public'`)[0].n).toBe(3);
  });

  it("preserves database microseconds in discovery and day history, including later refresh", async () => {
    const id='precise0001';
    const old=new Date(Date.now()-35*DAY_MS);
    const runId=await legacyVideo(id,old);
    await db`update shorts_mvp.popular_video_items set collected_at=collected_at+interval '150 microseconds' where run_id=${runId}`;
    const [source]=await db`select collected_at::text as original from shorts_mvp.popular_video_items where run_id=${runId}`;
    const fetchImpl=async()=>new Response(JSON.stringify({items:[youtubeItem(id)]}));
    await backfillCatalogBatch(db,fetchImpl);
    await db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    await refreshCatalogBatch({db,fetchImpl});
    const [catalog]=await db`select first_discovered_at::text as first,last_trending_at::text as trending from shorts_mvp.youtube_catalog`;
    const [day]=await db`select first_seen_at::text as first,last_seen_at::text as last from shorts_mvp.youtube_trending_days`;
    expect(catalog.first).toBe(source.original);
    expect(catalog.trending).toBe(source.original);
    expect(day.first).toBe(source.original);
    expect(day.last).toBe(source.original);
  });

  it.each([undefined, "false", "true"])(
    "keeps expired legacy free history unless cleanup is explicitly released (%s)",
    async (cleanup) => {
      vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "false");
      vi.stubEnv("YOUTUBE_LEGACY_SNAPSHOT_CLEANUP_ENABLED", cleanup);
      const now = new Date();
      const fetchPage = (id: string) =>
        vi.fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ items: [{ id: { videoId: id } }] })),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ items: [youtubeItem(id)] })),
          );
      const old = await collectFreeVideos({
        db,
        now: new Date(now.getTime() - 4 * DAY_MS),
        maxPages: 1,
        fetchImpl: fetchPage("dQw4w9WgXcQ"),
      });
      const original = await db`select * from shorts_mvp.free_video_items where run_id=${old.runId}`;
      expect(original).toHaveLength(1);
      const next = await collectFreeVideos({
        db,
        now,
        maxPages: 1,
        fetchImpl: fetchPage("9bZkp7q19f0"),
      });
      const preserved = await db`select * from shorts_mvp.free_video_items where run_id=${old.runId}`;
      expect(preserved).toEqual(cleanup === "true" ? [] : original);
      const latest = await db`select status,item_count from shorts_mvp.free_video_runs where id=${next.runId}`;
      expect(latest[0]).toMatchObject({ status: "ready", itemCount: 1 });
    },
  );

  it("does not classify newly collected daily compatibility snapshots as historical imports", async () => {
    const result = await collectDiscoveryLane("views", {
      db,
      legacy: true,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
    });
    expect(result.failed).toBe(0);
    const [record] =
      await db`select legacy from shorts_mvp.youtube_collection_runs where id=${result.runId!}`;
    expect(record.legacy).toBe(false);
    expect(await backfillCatalogBatch(db)).toEqual({ done: true });
  });

  it("uses the new API verification when both legacy and canonical metadata have expired", async () => {
    const old = new Date(Date.now() - 35 * DAY_MS);
    await legacyVideo("stale000001", old);
    await saveCatalogPage(
      db,
      [fixture("stale000001", { title: "Still stale" })],
      {
        observedAt: new Date(Date.now() - 31 * DAY_MS),
      },
    );
    const fetched = {
      ...youtubeItem("stale000001"),
      snippet: {
        ...youtubeItem("stale000001").snippet,
        title: "New verification",
      },
    };
    await backfillCatalogBatch(
      db,
      vi.fn(async () => new Response(JSON.stringify({ items: [fetched] }))),
    );
    const [record] =
      await db`select metadata,first_discovered_at,verified_at from shorts_mvp.youtube_catalog`;
    expect(record.metadata.title).toBe("New verification");
    expect(new Date(record.verifiedAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(new Date(record.firstDiscoveredAt).toISOString()).toBe(
      old.toISOString(),
    );
  });

  it("records a confirmed unavailable backfill result without losing the historical membership", async () => {
    const old = new Date(Date.now() - 35 * DAY_MS);
    await legacyVideo("gone0000001", old);
    await saveCatalogPage(db, [fixture("gone0000001")], {
      observedAt: new Date(Date.now() - 31 * DAY_MS),
    });
    await backfillCatalogBatch(
      db,
      vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
    );
    const [record] =
      await db`select metadata,availability,first_discovered_at from shorts_mvp.youtube_catalog`;
    expect(record.metadata).toBeNull();
    expect(record.availability).toBe("unavailable");
    expect(new Date(record.firstDiscoveredAt).toISOString()).toBe(
      old.toISOString(),
    );
    expect(
      (await getTrendingCalendar(kstDate(old).slice(0, 7), db)).days.find(
        (d) => d.date === kstDate(old),
      ),
    ).toMatchObject({ totalCount: 1, unavailableCount: 1 });
  });

  it("keeps calendar collection records on the observed day when a run crosses KST midnight", async () => {
    const before = new Date("2026-08-31T14:59:00Z"),
      after = new Date("2026-08-31T15:01:00Z");
    const runId = await run(before, "success", true);
    await saveCatalogPage(db, [fixture("midnight001")], {
      runId,
      trending: true,
      observedAt: after,
    });
    const calendar = await getTrendingCalendar(
      "2026-09",
      db,
      new Date("2026-09-02T00:00:00Z"),
    );
    expect(calendar.days[0]).toMatchObject({
      date: "2026-09-01",
      collections: 1,
      totalCount: 1,
      status: "complete",
      legacy: true,
    });
  });

  it("checks current visibility from the DB without leaking expired or missing metadata", async () => {
    const now = new Date();
    await saveCatalogPage(
      db,
      [fixture("visible0001", { license: "creativeCommon" })],
      { observedAt: now, trending: true },
    );
    await saveCatalogPage(db, [fixture("expired0001")], {
      observedAt: new Date(now.getTime() - 31 * DAY_MS),
    });
    expect(
      await getCatalogVisibility(
        ["visible0001", "expired0001", "missing0001"],
        db,
        now,
      ),
    ).toEqual([
      {
        videoId: "visible0001",
        available: true,
        license: "creativeCommon",
        recentTrending: true,
        currentTrending: false,
      },
      {
        videoId: "expired0001",
        available: false,
        license: null,
        recentTrending: false,
        currentTrending: false,
      },
      {
        videoId: "missing0001",
        available: false,
        license: null,
        recentTrending: false,
        currentTrending: false,
      },
    ]);
  });

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
    await saveCatalogPage(
      db,
      [fixture("expired0001", { license: "creativeCommon" })],
      {
        observedAt: old,
        trending: true,
      },
    );
    await db`insert into shorts_mvp.site_metrics(key,value,updated_at) values('reusable_views_target',100,${old}) on conflict(key) do update set value=100`;
    await purgeExpiredCatalog(db, now);
    expect(
      (
        await db`select value from shorts_mvp.site_metrics where key='reusable_views_target'`
      )[0].value,
    ).toBe("0");
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
      values('test-project','wrong-key',100,10000,true,now(),'mock test evidence',now(),now()) on conflict(project_id) do update set key_fingerprint=excluded.key_fingerprint,other_clients_reviewed=true,expanded_at=now(),backfill_verified_at=now()`;
    expect(await expandedDiscoveryEnabled(db)).toBe(false);
    await db`update shorts_mvp.youtube_quota_verifications set key_fingerprint=${createHash('sha256').update('test-api-key').digest('hex')}`;
    expect(await expandedDiscoveryEnabled(db)).toBe(true);
    await db`update shorts_mvp.youtube_quota_verifications set accounting_ready_from=(now() at time zone 'America/Los_Angeles')::date+1`;
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
    // Failed legacy runs can contain rows excluded from the successful import.
    // Never sweep those rows merely because the failed run itself was recorded.
    const failedId = randomUUID();
    const failedAt = new Date(old.getTime() - DAY_MS);
    await db`insert into shorts_mvp.popular_video_runs(id,snapshot_date,status,started_at,completed_at,page_count,item_count)
      values(${failedId},${kstDate(failedAt)},'failed',${failedAt},${failedAt},1,1)`;
    await db`insert into shorts_mvp.popular_video_items(run_id,video_id,category,category_rank,page_number,title,channel_name,thumbnail_url,duration_seconds,view_count,published_at,license,is_korean,collected_at)
      values(${failedId},'failed00001','entertainment',1,1,'Unreconciled row','channel','https://example.com/old.jpg',600,1,${failedAt},'youtube',true,${failedAt})`;
    expect(await backfillCatalogBatch(db, fetchImpl)).toMatchObject({
      processed: 0,
    });
    await db`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,verified_at,evidence,backfill_verified_at)
      values('test-project','test-only',100,10000,now(),'integration comparison passed',now()) on conflict(project_id) do update set backfill_verified_at=now()`;
    // A completed backfill must not itself authorize destruction of old rows.
    vi.stubEnv("YOUTUBE_LEGACY_SNAPSHOT_CLEANUP_ENABLED", "false");
    await cleanupImportedSnapshots(db);
    expect(
      (
        await db`select count(*)::int as count from shorts_mvp.popular_video_items`
      )[0].count,
    ).toBe(2);
    vi.stubEnv("YOUTUBE_LEGACY_SNAPSHOT_CLEANUP_ENABLED", "true");
    // Even with the cleanup switch on, a stale verification cannot hide a gap.
    await db`update shorts_mvp.youtube_catalog set first_discovered_at=clock_timestamp()`;
    await cleanupImportedSnapshots(db);
    expect(
      (
        await db`select count(*)::int as count from shorts_mvp.popular_video_items`
      )[0].count,
    ).toBe(2);
    await db`update shorts_mvp.youtube_catalog set first_discovered_at=${old}`;
    await cleanupImportedSnapshots(db);
    expect(
      (
        await db`select count(*)::int as count from shorts_mvp.popular_video_items`
      )[0].count,
    ).toBe(1);
    expect(
      (await db`select video_id from shorts_mvp.popular_video_items`)[0]
        .videoId,
    ).toBe("failed00001");
    expect(
      (await getTrendingCalendar(kstDate(old).slice(0, 7), db)).days.find(
        (d) => d.date === kstDate(old),
      ),
    ).toMatchObject({ collections: 1, legacy: true });
  });
});
