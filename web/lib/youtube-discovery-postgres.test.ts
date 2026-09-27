import { getJapanSettings, updateJapanSettings } from "./youtube-japan-settings";
import { collectJapanVideos } from "./youtube-japan-collector";
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
  catalogStatus,
  markCatalogMetadataPending,
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
import { getReusableViewCounterSchedule, refreshCatalogViewCounter } from "./reusable-view-counter-server";
import { projectReusableViewCounter } from "./reusable-view-counter";
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
        "202609110002_youtube_pending_metadata.sql",
        "202609110003_youtube_collection_recency.sql",
        "202609110010_youtube_japan_discovery.sql",
        "202609110011_youtube_japan_quota.sql",
        "202609110012_youtube_japan_activation_constraints.sql",
        "202609280001_popular_english_filter.sql",
      ]) {
        if (name === "202609110010_youtube_japan_discovery.sql") {
          await migrationDb`insert into shorts_mvp.youtube_catalog(id,video_id,metadata,first_discovered_at,verified_at,last_trending_at,trending_rank)
            values('rolling-existing','existing001',${migrationDb.json({videoId:"existing001",title:"既存の動画"})},'2026-09-09Z',now(),'2026-09-09Z',9)`;
          await migrationDb`insert into shorts_mvp.youtube_collection_recency(catalog_id,last_collected_at) values('rolling-existing','2026-09-09Z')`;
        }
        if (name === "202609110012_youtube_japan_activation_constraints.sql") {
          await migrationDb`update shorts_mvp.youtube_catalog set last_trending_at='2026-09-10Z',trending_rank=2 where id='rolling-existing'`;
          await migrationDb`update shorts_mvp.youtube_collection_recency set last_collected_at='2026-09-10Z' where catalog_id='rolling-existing'`;
          // Phase 1 must accept the old deployment's conflict targets. Phase 2
          // catches up its metadata without a YouTube request.
          await migrationDb`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at)
            values('trending','1970-01-01Z') on conflict(lane,scheduled_at) do nothing`;
          await migrationDb`insert into shorts_mvp.youtube_catalog(id,video_id,metadata,first_discovered_at,verified_at)
            values('rolling-upgrade','rolling0001',${migrationDb.json({videoId:"rolling0001",title:"楽しい動画"})},now(),now())`;
          await migrationDb`insert into shorts_mvp.youtube_trending_days(day,catalog_id,first_seen_at,last_seen_at)
            values('1970-01-01','rolling-upgrade',now(),now()) on conflict(day,catalog_id) do nothing`;
        }
        await migrationDb.unsafe(
          readFileSync(path.resolve("../supabase/migrations", name), "utf8"),
        );
      }
      const [caughtUp] = await migrationDb`select first_discovered_at,last_collected_at,last_trending_at,trending_rank from shorts_mvp.youtube_catalog_regions where catalog_id='rolling-existing'`;
      expect(caughtUp.firstDiscoveredAt.toISOString()).toBe('2026-09-09T00:00:00.000Z');
      expect(caughtUp.lastCollectedAt.toISOString()).toBe('2026-09-10T00:00:00.000Z');
      expect(caughtUp.lastTrendingAt.toISOString()).toBe('2026-09-10T00:00:00.000Z');
      expect(caughtUp.trendingRank).toBe(2);
      expect((await migrationDb`select metadata->>'isJapanese' as japanese from shorts_mvp.youtube_catalog where id='rolling-upgrade'`)[0].japanese).toBe("true");
      expect((await migrationDb`select region_code from shorts_mvp.youtube_catalog_regions where catalog_id='rolling-upgrade'`)[0].regionCode).toBe("KR");
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
      shorts_mvp.youtube_japan_batches,shorts_mvp.youtube_japan_settings_audit,shorts_mvp.popular_video_runs,shorts_mvp.popular_search_runs,shorts_mvp.free_video_runs cascade`);
    await db`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,verified_at,evidence,accounting_ready_from)
      values('test-project','test',100,10000,now(),'isolated fixture',(now() at time zone 'America/Los_Angeles')::date)`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db?.end();
  });

  it("filters English across counts, pages and current metadata; rejects another language cursor", async () => {
    const now = new Date();
    await saveCatalogPage(db, [
      ...Array.from({length:55}, (_,i)=>fixture(`eng${String(i).padStart(8,"0")}`, {isEnglish:true,isKorean:false,license:"creativeCommon"})),
      fixture("unknown0001", {isKorean:false}), fixture("korean00001"), fixture("japan000001", {isJapanese:true,isKorean:false}),
    ], {observedAt:now});
    const first=await getCatalogVideos(filters({english:true,reusable:true,longForm:true}),db,now);
    expect(first.totalCount).toBe(55); expect(first.items).toHaveLength(48);
    const next=await getCatalogVideos(filters({english:true,reusable:true,longForm:true,cursor:first.nextCursor}),db,now);
    expect(next.items).toHaveLength(7);
    expect(next.items.every(item=>item.videoId.startsWith("eng"))).toBe(true);
    await expect(getCatalogVideos(filters({reusable:true,longForm:true,cursor:first.nextCursor}),db,now)).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    await db`update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{isEnglish}','false') where video_id=${next.items[0].videoId}`;
    expect((await getCatalogVideos(filters({english:true,reusable:true,longForm:true,cursor:first.nextCursor}),db,now)).items).toHaveLength(6);
    const [column]=await db`select column_default,is_nullable from information_schema.columns where table_schema='shorts_mvp' and table_name='popular_filter_usage_events' and column_name='english_only'`;
    expect(column).toMatchObject({columnDefault:"false",isNullable:"NO"});
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

  it("copies history with missing statistics into a hidden retry state, then recovers without changing discovery dates", async () => {
    const id = "avTQRPUU1IM", old = new Date(Date.now() - 35 * DAY_MS);
    await legacyVideo(id, old);
    await legacyVideo(id, new Date(old.getTime() + DAY_MS));
    const incomplete = vi.fn(async () => new Response(JSON.stringify({ items: [{ ...youtubeItem(id), statistics: {} }] })));
    await backfillCatalogBatch(db, incomplete);
    await backfillCatalogBatch(db, incomplete);
    expect(incomplete).toHaveBeenCalledTimes(1);
    expect(await getCatalogBackfillReadiness(db)).toMatchObject({ ready: true, pendingMetadata: 1 });
    const [pending] = await db`select * from shorts_mvp.youtube_catalog`;
    expect(pending.videoId).toBe(id);
    expect(pending.availability).toBe("public");
    expect(pending.metadata).toBeNull();
    expect(pending.metadataPendingAt).toBeTruthy();
    expect(new Date(pending.verifiedAt).toISOString()).toBe(old.toISOString());
    expect((await getCatalogVideos(filters(), db)).totalCount).toBe(0);
    expect((await db`select count(*)::int n from shorts_mvp.youtube_trending_days`)[0].n).toBe(2);
    // A later import of stale API fields cannot revive the pending item.
    await saveCatalogPage(db, [fixture(id)], { observedAt: new Date(old.getTime() + DAY_MS) });
    expect((await db`select metadata from shorts_mvp.youtube_catalog`)[0].metadata).toBeNull();
    await db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    const valid = vi.fn(async () => new Response(JSON.stringify({ items: [youtubeItem(id, 'creativeCommon')] })));
    await refreshCatalogBatch({ db, fetchImpl: valid });
    const [recovered] = await db`select * from shorts_mvp.youtube_catalog`;
    expect(recovered.metadataPendingAt).toBeNull();
    expect(recovered.metadata.license).toBe('creativeCommon');
    expect(new Date(recovered.firstDiscoveredAt).toISOString()).toBe(old.toISOString());
    expect((await getCatalogVideos(filters({type:'reusable'}), db)).totalCount).toBe(1);
    expect((await db`select count(*)::int n from shorts_mvp.popular_video_items`)[0].n).toBe(2);
  });

  it("leaves a malformed import batch checkpoint unchanged", async () => {
    await legacyVideo('invalid0001', new Date(Date.now() - 35 * DAY_MS));
    await expect(backfillCatalogBatch(db, async () => new Response(JSON.stringify({items:[{...youtubeItem('invalid0001'),status:{}}]})))).rejects.toThrow();
    expect((await db`select next_offset from shorts_mvp.youtube_catalog_imports`)[0].nextOffset).toBe(0);
    expect((await db`select count(*)::int n from shorts_mvp.youtube_catalog`)[0].n).toBe(0);
  });

  it("refreshes valid neighbors while retaining an incomplete public identifier for a later retry", async () => {
    const old = new Date(Date.now() - 2 * DAY_MS);
    await saveCatalogPage(db, [fixture('avTQRPUU1IM'), fixture('valid000001')], { observedAt: old });
    const response = async () => new Response(JSON.stringify({items:[{...youtubeItem('avTQRPUU1IM'),statistics:{}},youtubeItem('valid000001','creativeCommon')]}));
    await refreshCatalogBatch({db, fetchImpl:response});
    const rows = await db`select video_id,metadata,metadata_pending_at,verified_at from shorts_mvp.youtube_catalog order by video_id`;
    expect(rows[0].metadata).toBeNull();
    expect(rows[0].metadataPendingAt).toBeTruthy();
    expect(new Date(rows[0].verifiedAt).toISOString()).toBe(old.toISOString());
    expect(rows[1].metadata.license).toBe('creativeCommon');
    await purgeExpiredCatalog(db, new Date(Date.now() + 31 * DAY_MS));
    expect((await db`select count(*)::int n from shorts_mvp.youtube_catalog where video_id is not null`)[0].n).toBe(0);
    expect((await db`select count(*)::int n from shorts_mvp.youtube_catalog`)[0].n).toBe(2);
  });

  it("does not let an older partial response overwrite a newer full verification", async () => {
    const now = new Date();
    await saveCatalogPage(db, [fixture('avTQRPUU1IM')], {observedAt:now});
    await markCatalogMetadataPending(db, ['avTQRPUU1IM'], now, new Date(now.getTime()-1000));
    expect((await db`select metadata,metadata_pending_at from shorts_mvp.youtube_catalog`)[0]).toMatchObject({metadataPendingAt:null,metadata:{viewCount:100}});
  });

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

  it("persists animation through concurrent collections, unchanged totals, and license removal", async () => {
    const now = new Date();
    await db`delete from shorts_mvp.site_metrics where key like 'reusable_views_%'`;
    await db.begin(async (tx) => {
      await saveCatalogPage(tx, [fixture('counter0001', { license: 'creativeCommon', viewCount: 1_000_000 })], { observedAt: now });
      await refreshCatalogViewCounter(tx, now);
    });
    await Promise.all(['counter0002', 'counter0003'].map((id) => db.begin(async (tx) => {
      await saveCatalogPage(tx, [fixture(id, { license: 'creativeCommon', viewCount: 500_000 })], { observedAt: now });
      await refreshCatalogViewCounter(tx, now);
    })));
    const growing = await getReusableViewCounterSchedule(db);
    expect(growing).toMatchObject({ startValue: 1_000_000, targetValue: 2_000_000 });
    expect(projectReusableViewCounter(growing!, now.getTime() + 5_000).value).toBeGreaterThan(1_000_000);
    await db.begin((tx) => refreshCatalogViewCounter(tx, new Date(now.getTime() + 60_000)));
    expect(await getReusableViewCounterSchedule(db)).toEqual(growing);
    await db.begin(async (tx) => {
      await tx`update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{license}','"youtube"') where video_id in ('counter0001','counter0002')`;
      await refreshCatalogViewCounter(tx, new Date(now.getTime() + 60_000));
    });
    expect(await getReusableViewCounterSchedule(db)).toMatchObject({ startValue: 500_000, targetValue: 500_000 });
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

  it("refreshes a bounded batch and leaves remaining videos for the next run", async () => {
    const now = new Date();
    const videos = Array.from({ length: 405 }, (_, i) => fixture(`batch${String(i).padStart(6, "0")}`));
    const dates = new Map(videos.map((item, i) => [
      item.videoId, `2026-01-01 00:00:00.${String(i + 1).padStart(6, "0")}+00`,
    ]));
    await saveCatalogPage(db, videos, {
      observedAt: now, firstDiscoveredAtByVideoId: dates,
    });
    await db`update shorts_mvp.youtube_catalog set refresh_after=now()-interval '1 minute'`;
    const before = await db`select id,first_discovered_at::text as first from shorts_mvp.youtube_catalog order by id`;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const ids = new URL(String(input)).searchParams.get("id")!.split(",");
      return new Response(JSON.stringify({ items: ids.map((id) => youtubeItem(id)) }));
    });
    const first = await refreshCatalogBatch({ db, fetchImpl, scheduledAt: now });
    expect(first).toMatchObject({ pages: 8, failed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect((await db`select count(*)::int as n from shorts_mvp.youtube_catalog where refresh_after<=now()`)[0].n).toBe(5);
    expect((await db`select status,finished_at from shorts_mvp.youtube_collection_runs where id=${first.runId!}`)[0])
      .toMatchObject({ status: "success", finishedAt: expect.any(Date) });
    await expect(refreshCatalogBatch({
      db, fetchImpl, scheduledAt: new Date(now.getTime() + 900_000),
    })).resolves.toMatchObject({ pages: 1, failed: false });
    expect(await db`select id,first_discovered_at::text as first from shorts_mvp.youtube_catalog order by id`).toEqual(before);
    expect((await db`select count(*)::int as n from shorts_mvp.youtube_catalog where refresh_after<=now()`)[0].n).toBe(0);
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
  it.each(["views", "reusable"] as const)("rolls %s over only after 17:20 and successful afternoon collection", async (type) => {
    const scope = filters({ type, periodBasis: "collected", period: "today" });
    const previousSlot = new Date("2026-09-10T08:10:00Z");
    const nextSlot = new Date("2026-09-11T08:10:00Z");
    const makeRun = async (at: Date, status: string, finished: Date | null) => {
      const [r] = await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,finished_at,status)
        values(${type},${at},${at},${finished},${status}) returning id`;
      return String(r.id);
    };
    const video = (id: string, viewCount = 100) => fixture(id, { license: type === "reusable" ? "creativeCommon" : "youtube", viewCount });
    const previousRun = await makeRun(previousSlot, "success", new Date("2026-09-10T08:15:00Z"));
    await saveCatalogPage(db, Array.from({ length: 49 }, (_, i) => video(String(i).padStart(11, "0"), 1000 - i)), { runId: previousRun, observedAt: previousSlot });
    const nextRun = await makeRun(nextSlot, "running", null);
    await saveCatalogPage(db, [video("newvideo001")], { runId: nextRun, observedAt: new Date("2026-09-11T08:11:00Z") });
    const early = await getCatalogVideos(scope, db, new Date("2026-09-11T08:19:59Z"));
    expect(early.totalCount).toBe(50);
    expect(early.collectionWindowStart).toBe(previousSlot.toISOString());
    expect(early.nextCursor).toBeTruthy();
    const pending = await getCatalogVideos(scope, db, new Date("2026-09-11T08:20:00Z"));
    expect(pending.version).toBe(early.version);
    expect(pending.totalCount).toBe(50);
    await db`update shorts_mvp.youtube_collection_runs set status='failed',finished_at='2026-09-11T08:30:00Z' where id=${nextRun}`;
    expect((await getCatalogVideos(scope, db, new Date("2026-09-11T08:31:00Z"))).collectionWindowStart).toBe(previousSlot.toISOString());
    // A retried/delayed run must not switch the list until its success is visible.
    await db`update shorts_mvp.youtube_collection_runs set status='success',finished_at='2026-09-11T08:35:00Z' where id=${nextRun}`;
    expect((await getCatalogVideos(scope, db, new Date("2026-09-11T08:34:59Z"))).totalCount).toBe(50);
    const switched = await getCatalogVideos(scope, db, new Date("2026-09-11T08:35:00Z"));
    expect(switched.items.map(v => v.videoId)).toEqual(["newvideo001"]);
    expect(switched.totalCount).toBe(1);
    expect(switched.periodCounts).toEqual({ all: 50, today: 1, week: 50 });
    expect(switched.collectionWindowStart).toBe(nextSlot.toISOString());
    await expect(getCatalogVideos({ ...scope, cursor: early.nextCursor }, db, new Date("2026-09-11T08:35:00Z"))).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    // Even when the run finishes early, 17:20 itself changes generation/cache.
    await db`update shorts_mvp.youtube_collection_runs set finished_at='2026-09-11T08:15:00Z' where id=${nextRun}`;
    const before = await getCatalogVideos(scope, db, new Date("2026-09-11T08:19:59Z"));
    const after = await getCatalogVideos(scope, db, new Date("2026-09-11T08:20:00Z"));
    expect(before.totalCount).toBe(50);
    expect(after.totalCount).toBe(1);
    expect(before.generation).not.toBe(after.generation);
    expect((await catalogStatus(db, type, new Date("2026-09-11T08:20:00Z"))).generation).toBe(after.generation);
    const midnight = await getCatalogVideos(scope, db, new Date("2026-09-11T15:00:00Z"));
    expect(midnight.totalCount).toBe(1);
    expect(midnight.collectionWindowStart).toBe(after.collectionWindowStart);
    const morning = new Date("2026-09-11T20:10:00Z");
    const morningRun = await makeRun(morning, "success", new Date("2026-09-11T20:15:00Z"));
    await saveCatalogPage(db, [video("morning0001", 200)], { runId: morningRun, observedAt: morning });
    const combined = await getCatalogVideos(scope, db, new Date("2026-09-11T20:15:00Z"));
    expect(combined.items.map(v => v.videoId)).toEqual(["morning0001", "newvideo001"]);
    expect(combined.collectionWindowStart).toBe(after.collectionWindowStart);
    expect((await getCatalogVideos({ ...scope, period: "all" }, db, new Date("2026-09-11T20:15:00Z"))).totalCount).toBe(51);
    // A missing next afternoon run also retains this completed window.
    expect((await getCatalogVideos(scope, db, new Date("2026-09-12T08:25:00Z"))).totalCount).toBe(2);
  });

  it("keeps seven-day counts aligned and preserves the catalog before the first successful afternoon", async () => {
    const now = new Date("2026-09-11T08:20:00Z");
    const scope = filters({ type: "views", periodBasis: "collected", period: "today" });
    const oldRun = await run(new Date("2026-09-05T08:09:59Z"));
    await saveCatalogPage(db, [fixture("beforeweek1")], { runId: oldRun, observedAt: new Date("2026-09-05T08:09:59Z"), verifiedAt: now });
    await saveCatalogPage(db, [fixture("weekedge001")], { runId: oldRun, observedAt: new Date("2026-09-05T08:10:00Z"), verifiedAt: now });
    expect((await getCatalogVideos(scope, db, now)).totalCount).toBe(2);
    const [r] = await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,finished_at,status)
      values('views','2026-09-11T08:10:00Z','2026-09-11T08:10:00Z','2026-09-11T08:15:00Z','success') returning id`;
    await saveCatalogPage(db, [fixture("todayedge01")], { runId: String(r.id), observedAt: new Date("2026-09-11T08:10:00Z") });
    const weekly = await getCatalogVideos({ ...scope, period: "week" }, db, now);
    expect(weekly.items.map(v => v.videoId).sort()).toEqual(["todayedge01", "weekedge001"]);
    expect(weekly.periodCounts).toEqual({ all: 3, today: 1, week: 2 });
  });

  it("shows cumulative collected periods, including every CC source, without confusing refreshes with collections", async () => {
    const now = new Date("2026-09-11T09:00:00Z");
    const old = new Date("2026-09-01T08:00:00Z");
    const week = new Date("2026-09-06T08:00:00Z");
    const oldRun = await run(old);
    const weekRun = await run(week);
    const currentRun = await run(now);
    const cc = (id: string) => fixture(id, {license:"creativeCommon"});
    await saveCatalogPage(db, [cc("oldtrend001"),cc("repeated001"),fixture("oldplain001")], {runId:oldRun,trending:true,observedAt:old,verifiedAt:now});
    await saveCatalogPage(db, [cc("weekseen001")], {runId:weekRun,trending:true,observedAt:week,verifiedAt:now});
    await saveCatalogPage(db, [cc("nowtrend001")], {runId:currentRun,trending:true,observedAt:now});
    const [freeRun] = await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,finished_at,status) values('free',${now},${now},${now},'success') returning id`;
    await saveCatalogPage(db, [cc("freeonly001"),cc("repeated001")], {runId:String(freeRun.id),observedAt:now});
    // Same ID in more than one page must remain one result and keep its first date.
    await saveCatalogPage(db, [cc("repeated001")], {runId:String(freeRun.id),observedAt:now});
    await saveCatalogPage(db, [cc("oldtrend001")], {observedAt:now});
    const scope = filters({type:"trending",reusable:true,periodBasis:"collected"});
    const all = await getCatalogVideos(scope,db,now);
    expect(all.totalCount).toBe(5);
    expect(all.items[0]).toMatchObject({videoId:"nowtrend001",isCurrentTrending:true});
    const today = await getCatalogVideos({...scope,period:"today"},db,now);
    expect(today.items.map(v=>v.videoId).sort()).toEqual(["freeonly001","nowtrend001","repeated001"]);
    expect(today.periodCounts).toEqual({all:5,today:3,week:4});
    const weekly = await getCatalogVideos({...scope,period:"week"},db,now);
    expect(weekly.items).toHaveLength(4);
    const [unchanged] = await db`select first_discovered_at from shorts_mvp.youtube_catalog where video_id='repeated001'`;
    expect(unchanged.firstDiscoveredAt.toISOString()).toBe(old.toISOString());
    await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,finished_at,status)
      values('reusable','2026-09-11T08:10:00Z','2026-09-11T08:10:00Z','2026-09-11T08:15:00Z','success')`;
    const mainCC = await getCatalogVideos({...scope,type:"reusable",reusable:false,period:"today"},db,now);
    expect(mainCC.items.map(v=>v.videoId).sort()).toEqual(today.items.map(v=>v.videoId).sort());
    const plainTrending = await getCatalogVideos({...scope,reusable:false},db,now);
    expect(plainTrending.items.some(v=>v.videoId==="oldplain001")).toBe(true);
    expect(plainTrending.items.some(v=>v.videoId==="freeonly001")).toBe(false);
    // API clients retaining the old contract and historical-date reads still work.
    expect((await getCatalogVideos({...scope,periodBasis:undefined},db,now)).totalCount).toBe(1);
    expect((await getCatalogVideos({...scope,date:"2026-09-01"},db,now)).totalCount).toBe(2);
    const nextDay = new Date("2026-09-11T15:00:00Z");
    expect((await getCatalogVideos({...scope,period:"today"},db,nextDay)).totalCount).toBe(0);
    expect((await getCatalogVideos(scope,db,nextDay)).totalCount).toBe(5);
    // Refresh writes with a run ID are also excluded from the collected clock.
    const [refreshRun] = await db`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,started_at,status) values('refresh',${nextDay},${nextDay},'running') returning id`;
    await saveCatalogPage(db,[cc("oldtrend001")],{runId:String(refreshRun.id),observedAt:nextDay});
    expect((await getCatalogVideos({...scope,period:"today"},db,nextDay)).totalCount).toBe(0);
    expect((await db`select count(*)::int n from shorts_mvp.youtube_quota_attempts`)[0].n).toBe(0);
  });

  it("keeps collected-page cursors stable and separate from old 24-hour lists", async () => {
    const now=new Date();
    const old=new Date(now.getTime()-10*DAY_MS);
    const oldRun=await run(old);
    const videos=Array.from({length:100},(_,i)=>fixture(`coll${String(i).padStart(7,"0")}`,{license:"creativeCommon",viewCount:1000-i}));
    await saveCatalogPage(db,videos,{runId:oldRun,observedAt:old,verifiedAt:now,trending:true});
    const scope=filters({type:"trending",reusable:true,periodBasis:"collected"});
    const first=await getCatalogVideos(scope,db,now);
    expect(first.items).toHaveLength(48);
    await expect(getCatalogVideos({...scope,periodBasis:undefined,cursor:first.nextCursor},db,now)).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    await saveCatalogPage(db,[fixture("coll0000060",{license:"creativeCommon",viewCount:9999}),fixture("coll0000050")],{observedAt:new Date(now.getTime()+1000)});
    const second=await getCatalogVideos({...scope,cursor:first.nextCursor},db,now);
    expect(second.items[0].videoId).toBe("coll0000048");
    expect(second.items.some(v=>v.videoId==="coll0000050")).toBe(false);
    expect(new Set([...first.items,...second.items].map(v=>v.videoId)).size).toBe(96);
  });
  it("restores collection recency from old records without rewriting catalog or source data", async () => {
    const old = new Date("2026-09-01T08:00:00Z");
    await legacyVideo("restore0001",old);
    await saveCatalogPage(db,[fixture("restore0001")],{observedAt:old,verifiedAt:new Date()});
    const original=await db`select (select jsonb_agg(to_jsonb(c)) from shorts_mvp.youtube_catalog c) catalog,
      (select jsonb_agg(to_jsonb(i)) from shorts_mvp.popular_video_items i) items,
      (select jsonb_agg(to_jsonb(r)) from shorts_mvp.popular_video_runs r) runs`;
    await db.unsafe(`drop trigger youtube_collection_recency_record on shorts_mvp.youtube_trending_run_items;
      drop function shorts_mvp.record_youtube_collection_recency();drop table shorts_mvp.youtube_collection_recency;`);
    const connection=await db.reserve();
    try { await connection.unsafe(readFileSync(path.resolve("../supabase/migrations/202609110003_youtube_collection_recency.sql"),"utf8")); }
    finally { connection.release(); }
    const after=await db`select (select jsonb_agg(to_jsonb(c)) from shorts_mvp.youtube_catalog c) catalog,
      (select jsonb_agg(to_jsonb(i)) from shorts_mvp.popular_video_items i) items,
      (select jsonb_agg(to_jsonb(r)) from shorts_mvp.popular_video_runs r) runs`;
    expect(after).toEqual(original);
    const [recency]=await db`select last_collected_at from shorts_mvp.youtube_collection_recency`;
    expect(recency.lastCollectedAt.toISOString()).toBe(old.toISOString());
  });
  it("counts missed new slots separately from old daily records on the activation date", async () => {
    await run(new Date('2026-09-10T08:00:00Z'),'success',true);
    await run(new Date('2026-09-11T04:00:00Z'),'success',true);
    await db`update shorts_mvp.youtube_quota_verifications set expanded_at='2026-09-11T05:00:00Z'`;
    const day = async (now:string) => (await getTrendingCalendar('2026-09',db,new Date(now))).days.find(d=>d.date==='2026-09-11');
    expect(await day('2026-09-11T05:30:00Z')).toMatchObject({collections:1,status:'complete'});
    expect(await day('2026-09-11T07:00:00Z')).toMatchObject({collections:1,status:'partial'});
    await run(new Date('2026-09-11T06:00:00Z'));
    expect(await day('2026-09-11T07:00:00Z')).toMatchObject({collections:2,status:'complete'});
    expect(await day('2026-09-11T09:00:00Z')).toMatchObject({collections:2,status:'partial'});
    expect((await getTrendingCalendar('2026-09',db,new Date('2026-09-11T09:00:00Z'))).days.find(d=>d.date==='2026-09-10')).toMatchObject({collections:1,legacy:true,status:'complete'});
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
  async function enableJapan() {
    vi.stubEnv("YOUTUBE_JP_COLLECTION_ENABLED", "true"); vi.stubEnv("YOUTUBE_JP_DISCOVERY_ENABLED", "true");
    await db`update shorts_mvp.youtube_quota_verifications set key_fingerprint=${createHash("sha256").update("test-api-key").digest("hex")},
      japan_collection_enabled=true,japan_discovery_enabled=true,japan_activated_at=clock_timestamp(),japan_verified_at=clock_timestamp(),japan_evidence='isolated test',japan_search_daily_ceiling=100,other_clients_reviewed=true where project_id='test-project'`;
  }
  it("collects Japan once: seven chart pages and ten searches, ignores all next-page tokens", async () => {
    await enableJapan();
    let serial = 0;
    let activeFetches = 0;
    let maximumFetches = 0;
    const licenses = new Map<string,string>();
    const fake = vi.fn(async (input: RequestInfo | URL) => {
      activeFetches++;
      maximumFetches = Math.max(maximumFetches, activeFetches);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeFetches--;
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) {
        expect(url.searchParams.get("regionCode")).toBe("JP"); expect(url.searchParams.get("relevanceLanguage")).toBe("ja");
        expect(url.searchParams.has("pageToken")).toBe(false);
        const id = `jp${String(++serial).padStart(9,"0")}`;
        licenses.set(id,url.searchParams.get("videoLicense") || "youtube");
        return new Response(JSON.stringify({items:[{id:{videoId:id}}],nextPageToken:"never-follow"}));
      }
      const id = url.searchParams.get("id") || `jp${String(++serial).padStart(9,"0")}`;
      if (url.searchParams.has("chart")) expect(url.searchParams.get("regionCode")).toBe("JP");
      const item = youtubeItem(id,licenses.get(id)); item.snippet.title="楽しい動画";
      return new Response(JSON.stringify({items:[item],nextPageToken:"never-follow"}));
    });
    const scheduledAt = new Date();
    const results = await Promise.all([
      collectJapanVideos({db,fetchImpl:fake,scheduledAt}),
      collectJapanVideos({db,fetchImpl:fake,scheduledAt}),
    ]);
    expect(results.filter(result => !result.skipped)).toEqual([expect.objectContaining({skipped:false,failed:false})]);
    expect(results.filter(result => result.skipped)).toHaveLength(1);
    expect(fake).toHaveBeenCalledTimes(27);
    expect(maximumFetches).toBe(1);
    const counts = await db`select bucket,sum(units)::int as units from shorts_mvp.youtube_quota_attempts where region_code='JP' group by bucket order by bucket`;
    expect(counts.map(row=>[row.bucket,row.units])).toEqual([["general",17],["search",10]]);
    expect((await getCatalogVideos(filters({japanese:true}),db)).items.every(item=>item.title==="楽しい動画")).toBe(true);
    // Japan's successful collection updates the counter without waiting for a
    // later Korean metadata refresh, and adds no YouTube requests.
    expect((await getReusableViewCounterSchedule(db))?.targetValue).toBe(700);
    await collectJapanVideos({db,fetchImpl:fake,scheduledAt}); expect(fake).toHaveBeenCalledTimes(27);
    expect((await db`select count(*)::int n from shorts_mvp.popular_video_runs`)[0].n).toBe(0);
  });
  it("keeps Japanese failed attempts charged without blocking original video lookup", async () => {
    await enableJapan();
    const attempt = () => withYoutubePurpose("views",db,()=>youtubeRequest("free",new URL("https://www.googleapis.com/youtube/v3/search"),{},async()=>{throw new Error("network failure");}),{region:"JP"});
    const settled = await Promise.allSettled(Array.from({length:9},attempt));
    expect(settled.every(result=>result.status==='rejected')).toBe(true);
    expect((await db`select sum(units)::int n from shorts_mvp.youtube_quota_attempts where region_code='JP' and bucket='search'`)[0].n).toBe(3);
    const original = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({items:[youtubeItem(url.searchParams.get('id') || 'source00001')]}));
    });
    vi.stubGlobal("fetch",original);
    const analysis = await withYoutubePurpose("analysis",db,()=>analyzeYoutubeUrl("https://www.youtube.com/watch?v=source00001"));
    expect(analysis.videoId).toBe("source00001"); expect(original).toHaveBeenCalledTimes(2);
  });
  it("enforces per-country general budgets under concurrent reservations", async () => {
    await enableJapan();
    const tasks = (["trending","reusable","views"] as const).flatMap(lane=>Array.from({length:12},()=>db`select shorts_mvp.reserve_youtube_japan_quota('test-project','general',${lane},1) id`));
    const results = await Promise.all(tasks);
    expect(results.filter(rows=>rows[0].id)).toHaveLength(17);
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) id`)[0].id).toBeTruthy();
    expect((await db`select bool_and(quota_day=(attempted_at at time zone 'America/Los_Angeles')::date) valid from shorts_mvp.youtube_quota_attempts`)[0].valid).toBe(true);
  });
  it("merges both countries without duplicates, freezes pages, and removes Japan on rollback", async () => {
    await enableJapan(); const now=new Date();
    const [kr]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at) values('trending','KR',${now},'success',${now}) returning id`;
    const [jp]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at) values('trending','JP',${now},'success',${now}) returning id`;
    await saveCatalogPage(db,[fixture('korean00001')],{runId:kr.id,regionCode:'KR',trending:true,observedAt:now});
    const japanese=Array.from({length:55},(_,index)=>fixture(`jp${String(index).padStart(9,'0')}`,{isKorean:false,isJapanese:true,title:'楽しい動画',viewCount:1000-index}));
    await saveCatalogPage(db,[fixture('korean00001'),...japanese],{runId:jp.id,regionCode:'JP',trending:true,observedAt:now});
    const first=await getCatalogVideos(filters({type:'trending'}),db,now);
    expect(first.totalCount).toBe(56); expect(first.items).toHaveLength(48);
    const ja=await getCatalogVideos(filters({type:'trending',japanese:true}),db,now); expect(ja.totalCount).toBe(55);
    const ko=await getCatalogVideos(filters({type:'trending',korean:true}),db,now); expect(ko.items.map(item=>item.videoId)).toEqual(['korean00001']);
    const later = new Date(now.getTime()+1000);
    const [newRun]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at) values('trending','JP',${later},'success',${later}) returning id`;
    await saveCatalogPage(db,[fixture('newjapan001',{isKorean:false,isJapanese:true,viewCount:99999})],{runId:newRun.id,regionCode:'JP',trending:true,observedAt:later});
    const second=await getCatalogVideos(filters({type:'trending',cursor:first.nextCursor}),db,later);
    expect(new Set([...first.items,...second.items].map(item=>item.videoId)).size).toBe(56);
    expect(second.items.some(item=>item.videoId==='newjapan001')).toBe(false);
    await expect(getCatalogVideos(filters({type:'trending',japanese:true,cursor:first.nextCursor}),db,later)).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    vi.stubEnv('YOUTUBE_JP_DISCOVERY_ENABLED','false');
    expect((await getCatalogVideos(filters({type:'trending'}),db,later)).items.map(item=>item.videoId)).toEqual(['korean00001']);
  });
  it("keeps a previous Japanese success visible when a later collection hits quota errors", async () => {
    await enableJapan(); const now=new Date();
    const [run]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at) values('trending','JP',${new Date(now.getTime()-1000)},'success',${now}) returning id`;
    await saveCatalogPage(db,[fixture('oldjapan001',{isKorean:false,isJapanese:true})],{runId:run.id,regionCode:'JP',trending:true,observedAt:now});
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}]}}),{status:403}));
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:now})).toMatchObject({failed:true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await getCatalogVideos(filters({type:'trending',japanese:true}),db)).items[0].videoId).toBe('oldjapan001');
  });

  it("reserves the existing Korean search allocation when the combined ceiling remains 90", async () => {
    await enableJapan();
    await db`update shorts_mvp.youtube_quota_verifications set japan_search_daily_ceiling=90`;
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    const result=await collectJapanVideos({db,fetchImpl});
    expect(result).toMatchObject({failed:false,results:[{lane:"trending"},{lane:"reusable",skipped:true},{lane:"views",skipped:true}]});
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect((await db`select shorts_mvp.reserve_youtube_japan_quota('test-project','search','views',1) id`)[0].id).toBeNull();
    const tasks=([["views",40],["reusable",20],["free",30]] as const).flatMap(([lane,count])=>
      Array.from({length:count+2},()=>db`select shorts_mvp.reserve_youtube_quota('test-project','search',${lane},1) id`));
    expect((await Promise.all(tasks)).filter(rows=>rows[0].id)).toHaveLength(90);
  });
  it("does not start Japan without current project evidence or after its deadline", async () => {
    await enableJapan();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    await db`update shorts_mvp.youtube_quota_verifications set japan_verified_at=clock_timestamp()-interval '8 days'`;
    expect(await collectJapanVideos({db,fetchImpl})).toMatchObject({skipped:true,reason:"japan_quota_unverified"});
    await enableJapan();
    vi.stubEnv("YOUTUBE_API_KEY","a-different-project-key");
    expect(await collectJapanVideos({db,fetchImpl})).toMatchObject({skipped:true,reason:"japan_quota_unverified"});
    vi.stubEnv("YOUTUBE_API_KEY","test-api-key");
    expect(await collectJapanVideos({db,fetchImpl,maxDurationMs:0})).toMatchObject({timedOut:true,results:[]});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("fails collection closed when usage cannot be recorded", async () => {
    await enableJapan();
    const brokenDb=vi.fn(()=>Promise.reject(new Error("accounting unavailable"))) as unknown as Sql;
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    await expect(withYoutubePurpose("trending",brokenDb,()=>youtubeRequest("trending",new URL("https://www.googleapis.com/youtube/v3/videos"),{},fetchImpl),{region:"JP"})).rejects.toMatchObject({name:"YoutubeQuotaError"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("caps concurrent Korean and Japanese searches at the explicitly verified allocation", async () => {
    await enableJapan();
    const kr=([["views",40],["reusable",20],["free",30]] as const).flatMap(([lane,count])=>
      Array.from({length:count+2},()=>db`select shorts_mvp.reserve_youtube_quota('test-project','search',${lane},1) id`));
    const jp=([["views",3],["reusable",7]] as const).flatMap(([lane,count])=>
      Array.from({length:count+2},()=>db`select shorts_mvp.reserve_youtube_japan_quota('test-project','search',${lane},1) id`));
    expect((await Promise.all([...kr,...jp])).filter(rows=>rows[0].id)).toHaveLength(100);
    const usage=await db`select region_code,sum(units)::int n from shorts_mvp.youtube_quota_attempts group by region_code order by region_code`;
    expect(usage.map(row=>[row.regionCode,row.n])).toEqual([["JP",10],["KR",90]]);
  });
  it("keeps all 9000 existing general units available after Japan uses its 17 units", async () => {
    await enableJapan();
    await db`insert into shorts_mvp.youtube_quota_opening_balances(project_id,quota_day,bucket,purpose,units,observed_through,evidence)
      values('test-project',(clock_timestamp() at time zone 'America/Los_Angeles')::date,'general','analysis',8999,clock_timestamp(),'isolated test')`;
    for (const [lane,count] of [["trending",7],["reusable",7],["views",3]] as const)
      expect((await db`select shorts_mvp.reserve_youtube_japan_quota('test-project','general',${lane},${count}) id`)[0].id).toBeTruthy();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) id`)[0].id).toBeTruthy();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) id`)[0].id).toBeNull();
  });
  it("continues a legacy Korean cursor after Japan exposure is enabled", async () => {
    await enableJapan(); const now=new Date();
    const krId=await run(now);
    const korean=Array.from({length:55},(_,index)=>fixture(`kr${String(index).padStart(9,"0")}`,{viewCount:1000-index}));
    await saveCatalogPage(db,korean,{runId:krId,trending:true,observedAt:now});
    vi.stubEnv("YOUTUBE_JP_DISCOVERY_ENABLED","false");
    const first=await getCatalogVideos(filters({type:"trending"}),db,now);
    await db`update shorts_mvp.youtube_list_versions set current_run_ids='{}' where id=${first.version!}`;
    vi.stubEnv("YOUTUBE_JP_DISCOVERY_ENABLED","true");
    const [jp]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at)
      values('trending','JP',${now},'success',${now}) returning id`;
    await saveCatalogPage(db,[fixture("japan000001",{isKorean:false,isJapanese:true,viewCount:99999})],{runId:jp.id,regionCode:"JP",trending:true,observedAt:now});
    const second=await getCatalogVideos(filters({type:"trending",cursor:first.nextCursor}),db,now);
    expect(second.items).toHaveLength(7); expect(second.totalCount).toBe(55);
    expect(second.items.every(item=>item.videoId.startsWith("kr"))).toBe(true);
    expect((await getCatalogVideos(filters({type:"trending"}),db,now)).totalCount).toBe(56);
  });
  it("does not spend the Korean refresh allocation on Japanese-only history", async () => {
    await enableJapan(); const now=new Date();
    const [jp]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at)
      values('trending','JP',${now},'success',${now}) returning id`;
    await saveCatalogPage(db,[fixture("japan000001",{isKorean:false,isJapanese:true})],{runId:jp.id,regionCode:"JP",trending:true,observedAt:now});
    await db`update shorts_mvp.youtube_catalog set refresh_after=clock_timestamp()-interval '1 hour'`;
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    expect(await refreshCatalogBatch({db,fetchImpl})).toMatchObject({pages:0,failed:false});
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv("YOUTUBE_JP_DISCOVERY_ENABLED","false");
    expect((await getCatalogVideos(filters({type:"trending"}),db)).items).toHaveLength(0);
  });

  it.each(["views", "reusable"] as const)("rolls %s independently at 17:20 and retains the failed country's window", async lane => {
    await enableJapan();
    const moment = (day: number, time: string) => new Date(`2026-09-${day}T${time}:00+09:00`);
    const add = async (region: "KR" | "JP", day: number, done: string, ids: string[]) => {
      const scheduled = moment(day, region === "KR" ? "17:10" : "17:15");
      const at = moment(day, done);
      const [run] = await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at)
        values(${lane},${region},${scheduled},'success',${at}) returning id`;
      await saveCatalogPage(db, ids.map(id=>fixture(id,{isKorean:false,isJapanese:true,license:lane==="reusable"?"creativeCommon":"youtube"})),
        {runId:run.id,regionCode:region,observedAt:at});
    };
    await add("KR",10,"17:11",["krprevious1"]);
    await add("JP",10,"17:18",["jpprevious1"]);
    await add("KR",11,"17:11",["krnewvideo1","sharedvid01"]);
    await add("JP",11,"17:23",["jpnewvideo1","sharedvid01"]);
    const scope = filters({type:lane,periodBasis:"collected",period:"today",japanese:true});
    const before = await getCatalogVideos(scope,db,moment(11,"17:19"));
    expect(before.collectionWindows).toEqual({KR:moment(10,"17:10").toISOString(),JP:moment(10,"17:15").toISOString()});
    const split = await getCatalogVideos(scope,db,moment(11,"17:20"));
    expect(split.collectionWindows).toEqual({KR:moment(11,"17:10").toISOString(),JP:moment(10,"17:15").toISOString()});
    expect(split.items.map(v=>v.videoId)).not.toContain("krprevious1");
    expect(split.items.map(v=>v.videoId)).toContain("jpprevious1");
    const after = await getCatalogVideos(scope,db,moment(11,"17:24"));
    expect(after.collectionWindowStart).toBe(moment(11,"17:10").toISOString());
    expect(after.collectionWindows?.JP).toBe(moment(11,"17:15").toISOString());
    expect(after.items.map(v=>v.videoId).sort()).toEqual(["jpnewvideo1","krnewvideo1","sharedvid01"].sort());
    expect(after.totalCount).toBe(3); expect(after.periodCounts?.today).toBe(3);
    expect(after.collectionWindowKey).not.toBe(split.collectionWindowKey);
    expect((await getCatalogVideos(scope,db,moment(12,"00:01")))).toMatchObject({totalCount:3,collectionWindowKey:after.collectionWindowKey});
    await db`update shorts_mvp.youtube_collection_runs set status='failed' where region_code='JP' and scheduled_at=${moment(11,"17:15")}`;
    const failed = await getCatalogVideos(scope,db,moment(11,"17:25"));
    expect(failed.collectionWindows?.KR).toBe(moment(11,"17:10").toISOString());
    expect(failed.collectionWindows?.JP).toBe(moment(10,"17:15").toISOString());
  });

  it("expires only period cursors on a Japanese window rollover and keeps all-page order", async () => {
    await enableJapan();
    const old = new Date("2026-09-10T08:15:00Z");
    const now = new Date("2026-09-11T08:19:00Z");
    const [run] = await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at)
      values('views','JP',${old},'success',${old}) returning id`;
    await saveCatalogPage(db,Array.from({length:55},(_,i)=>fixture(`jp${String(i).padStart(9,"0")}`,{viewCount:1000-i})),{runId:run.id,regionCode:"JP",observedAt:old});
    const scope=filters({periodBasis:"collected",period:"today"});
    const first=await getCatalogVideos(scope,db,now);
    const all=await getCatalogVideos({...scope,period:"all"},db,now);
    const later=new Date("2026-09-11T08:21:00Z");
    const [next] = await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at)
      values('views','JP','2026-09-11T08:15:00Z','success',${later}) returning id`;
    await saveCatalogPage(db,[fixture("jpnew000001")],{runId:next.id,regionCode:"JP",observedAt:later});
    await expect(getCatalogVideos({...scope,cursor:first.nextCursor},db,later)).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    const page=await getCatalogVideos({...scope,period:"all",cursor:all.nextCursor},db,later);
    expect(page.items).toHaveLength(7); expect(page.items.some(v=>v.videoId==="jpnew000001")).toBe(false);
  });

  it.each(["expired", "off"])("preserves all 90 Korean searches after Japanese consumption when Japan is %s", async mode => {
    await enableJapan();
    for (const [lane,units] of [["reusable",7],["views",3]] as const)
      expect((await db`select shorts_mvp.reserve_youtube_japan_quota('test-project','search',${lane},${units}) id`)[0].id).toBeTruthy();
    if(mode==="expired") await db`update shorts_mvp.youtube_quota_verifications set japan_verified_at=clock_timestamp()-interval '8 days'`;
    else await db`update shorts_mvp.youtube_quota_verifications set japan_collection_enabled=false`;
    for(const [lane,units] of [["views",40],["reusable",20],["free",30]] as const)
      expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','search',${lane},${units}) id`)[0].id).toBeTruthy();
    expect((await db`select shorts_mvp.reserve_youtube_japan_quota('test-project','general','trending',1) id`)[0].id).toBeNull();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','search','free',1) id`)[0].id).toBeNull();
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','general','analysis',1) id`)[0].id).toBeTruthy();
  });

  it("observes collection OFF between requests, then stops without publishing partial results", async () => {
    await enableJapan();
    const fetchImpl=vi.fn(async()=>{
      await db`update shorts_mvp.youtube_quota_verifications set japan_collection_enabled=false`;
      return new Response(JSON.stringify({items:[youtubeItem("stopped0001")]}));
    });
    const result=await collectJapanVideos({db,fetchImpl});
    expect(result).toMatchObject({failed:true}); expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await db`select count(*)::int n from shorts_mvp.youtube_catalog`)[0].n).toBe(0);
    expect((await db`select sum(units)::int n from shorts_mvp.youtube_quota_attempts where region_code='JP'`)[0].n).toBe(1);
  });

  it("gates exposure on all three initial results, records changes, and reads OFF without a redeploy", async () => {
    await enableJapan();
    await db`update shorts_mvp.youtube_quota_verifications set japan_discovery_enabled=false`;
    await expect(updateJapanSettings(db,randomUUID(),{collection:true,reads:true})).rejects.toMatchObject({status:409});
    const now=new Date();
    for(const lane of ["trending","views","reusable"])
      await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,finished_at) values(${lane},'JP',${now},'success',${now})`;
    await updateJapanSettings(db,randomUUID(),{collection:true,reads:true});
    expect((await getJapanSettings(db)).reads).toBe(true);
    await updateJapanSettings(db,randomUUID(),{collection:false,reads:false});
    expect(await getJapanSettings(db)).toMatchObject({collection:false,reads:false});
    expect((await db`select count(*)::int n from shorts_mvp.youtube_japan_settings_audit`)[0].n).toBe(2);
  });

  it("does not repeat manual and scheduled batches in one Pacific day or claim a future slot", async () => {
    await enableJapan();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    const firstSlot=new Date(Date.now()-3600000);
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:new Date(Date.now()+3600000)})).toMatchObject({skipped:true,reason:"future_slot"});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:firstSlot})).toMatchObject({skipped:false,failed:false});
    const calls=fetchImpl.mock.calls.length;
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:new Date()})).toMatchObject({skipped:true,reason:"already_collected"});
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    expect((await db`select bool_and(quota_day=(started_at at time zone 'America/Los_Angeles')::date) as valid from shorts_mvp.youtube_japan_batches`)[0].valid).toBe(true);
  });

  it("recovers an abandoned Japanese run on a later quota day without repeating the spent day", async () => {
    await enableJapan();
    const oldSlot=new Date(Date.now()-86400000);
    const [abandoned]=await db`insert into shorts_mvp.youtube_collection_runs(lane,region_code,scheduled_at,status,started_at)
      values('trending','JP',${oldSlot},'running',${oldSlot}) returning id`;
    await db`insert into shorts_mvp.youtube_japan_batches(project_id,quota_day,scheduled_at,started_at)
      values('test-project',(clock_timestamp() at time zone 'America/Los_Angeles')::date-1,${oldSlot},${oldSlot})`;
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:new Date()})).toMatchObject({skipped:false,failed:false});
    expect((await db`select status from shorts_mvp.youtube_collection_runs where id=${abandoned.id}`)[0].status).toBe('failed');
    const calls=fetchImpl.mock.calls.length;
    expect(calls).toBe(17);
    expect(await collectJapanVideos({db,fetchImpl,scheduledAt:new Date()})).toMatchObject({skipped:true,reason:'already_collected'});
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
  });

  it("starts a fresh Pacific-day budget without counting the previous day's reservations", async () => {
    await enableJapan();
    await db`insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units,region_code)
      values('test-project',(clock_timestamp() at time zone 'America/Los_Angeles')::date-1,'search','views',40,'KR'),
      ('test-project',(clock_timestamp() at time zone 'America/Los_Angeles')::date-1,'search','views',3,'JP')`;
    expect((await db`select shorts_mvp.reserve_youtube_quota('test-project','search','views',40) id`)[0].id).toBeTruthy();
    expect((await db`select shorts_mvp.reserve_youtube_japan_quota('test-project','search','views',3) id`)[0].id).toBeTruthy();
  });

});
