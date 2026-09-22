import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogId, CatalogCursorExpiredError, saveCatalogPage, searchCatalogVideos, type CatalogFilters, type CatalogVideo } from "./youtube-catalog";
import { popularSearchSql } from "./popular-text-search";

const connection = process.env.POPULAR_SEARCH_TEST_DATABASE_URL;
const integration = connection ? describe : describe.skip;
const now = new Date();
const filters = (q: string, extra: Partial<CatalogFilters> = {}) => ({ type: "views" as const, category: "all" as const, reusable: false, longForm: false, korean: false, period: "all" as const, q, ...extra });
const fixture = (id: string, title: string, extra: Partial<CatalogVideo> = {}): CatalogVideo => ({
  videoId: id, title, channelName: "테스트채널", thumbnailUrl: "https://example.com/thumb.jpg", category: "sports", durationSeconds: 600, viewCount: 100,
  publishedAt: "2026-01-01T00:00:00Z", license: "youtube", isKorean: true, ...extra,
});

integration("popular search on isolated PostgreSQL", () => {
  let db: Sql;
  beforeAll(async () => {
    const target = new URL(connection!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/youtube_search_test") throw new Error("Isolated local search DB required");
    db = postgres(connection!, { max: 4, transform: postgres.camel, onnotice: () => {}, connection: { statement_timeout: 10000 } });
    await db.unsafe(`drop schema if exists shorts_mvp cascade; create schema shorts_mvp;
      do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end $$;
      create table shorts_mvp.popular_filter_usage_events(id uuid primary key);
      create table shorts_mvp.youtube_analyses(id uuid primary key,expires_at timestamptz);`);
    const tx = await db.reserve();
    try {
      for (const name of [
        "202607140004_popular_video_snapshots.sql", "202607140005_remove_unavailable_popular_categories.sql", "202607150006_free_video_snapshots.sql",
        "202607150007_popular_search_snapshots.sql", "202607150009_korean_video_filter.sql", "202609090001_youtube_discovery_catalog.sql",
        "202609110001_youtube_quota_opening_balances.sql", "202609110002_youtube_pending_metadata.sql", "202609110003_youtube_collection_recency.sql",
        "202609110010_youtube_japan_discovery.sql", "202609110011_youtube_japan_quota.sql", "202609110012_youtube_japan_activation_constraints.sql",
        "202609230001_popular_text_search.sql",
      ]) await tx.unsafe(readFileSync(path.resolve("../supabase/migrations", name), "utf8"));
      const indexes = readFileSync(path.resolve("../supabase/migrations/202609230002_popular_text_search_indexes.sql"), "utf8");
      for (const statement of indexes.split(";").filter(part => part.trim())) await tx.unsafe(statement);
    } finally { tx.release(); }
  }, 30000);
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await db`truncate shorts_mvp.youtube_catalog, shorts_mvp.youtube_list_versions, shorts_mvp.youtube_collection_runs cascade`;
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db?.end(); });
  const search = (q: string, extra: Partial<CatalogFilters> = {}) => searchCatalogVideos(filters(q, extra), db, now);
  async function seed(items: CatalogVideo[]) {
    await saveCatalogPage(db, items, { observedAt: now, firstDiscoveredAt: new Date(now.getTime() - 90 * 86400000) });
  }
  it("finds names, spacing, aliases, multiple words and typos; exact results outrank popular fuzzy matches", async () => {
    await seed([
      fixture("search00001", "손흥민", { viewCount: 1 }), fixture("search00002", "손흥민 축구 실수", { viewCount: 90000 }),
      fixture("search00003", "축구 경기"), fixture("search00004", "Elon Musk 인터뷰"), fixture("search00005", "인공지능 강의"),
      fixture("search00006", "새 영상", { channelName: "일론 머스크" }), fixture("search00007", "ChatGPT 사용법"),
      fixture("search00008", "축구 농구", { license: "creativeCommon" }),
    ]);
    expect((await search("손흥민")).items[0].videoId).toBe("search00001");
    expect((await search("손흥밍")).items.map(v => v.videoId)).toContain("search00001");
    expect((await search("손흥밍")).includesSimilarResults).toBe(true);
    expect((await search("축구 실수")).items.map(v => v.videoId)).toEqual(["search00002"]);
    expect((await search("일론머스크")).items.map(v => v.videoId)).toEqual(expect.arrayContaining(["search00004", "search00006"]));
    expect((await search("AI 강의")).items.map(v => v.videoId)).toContain("search00005");
    expect((await search("챗지피티 사용법")).items.map(v => v.videoId)).toContain("search00007");
    expect((await search("축구")).items.map(v => v.videoId)).toContain("search00008");
    expect((await search("완전히없는단어")).items).toEqual([]);
  });
  it("uses current metadata and filters; never resurrects removed, expired or Japanese-hidden videos", async () => {
    await seed([fixture("latest00001", "축구 실수", { license: "creativeCommon" }), fixture("latest00002", "축구 실수"), fixture("latest00003", "축구 실수"), fixture("latest00004", "축구 실수", { durationSeconds: 120 }), fixture("latest00005", "축구 실수", { isJapanese: true, isKorean: false })]);
    await saveCatalogPage(db, [fixture("latest00001", "요리 레시피")], { observedAt: new Date(now.getTime()+1) });
    await db`update shorts_mvp.youtube_catalog set availability='unavailable' where video_id='latest00002'`;
    await db`update shorts_mvp.youtube_catalog set verified_at=${new Date(now.getTime()-31*86400000)} where video_id='latest00003'`;
    await db`update shorts_mvp.youtube_catalog_regions set region_code='JP' where catalog_id=${catalogId("latest00005")}`;
    expect((await search("축구 실수", { longForm: true })).items).toEqual([]);
    expect((await search("요리", { reusable: true })).items).toEqual([]);
    expect((await search("요리")).items.map(v => v.videoId)).toEqual(["latest00001"]);
    expect((await search("축구", { korean: true })).items.map(v => v.videoId)).toEqual(["latest00004"]);
  });
  it("treats wildcards literally and applies periods and categories", async () => {
    await seed([fixture("literal0001", "50% 할인"), fixture("literal0002", "50원 할인"), fixture("literal0003", "a_b 채널")]);
    expect((await search("50%")).items.map(v => v.videoId)).toEqual(["literal0001"]);
    expect((await search("a_")).items.map(v => v.videoId)).toEqual(["literal0003"]);
    expect((await search("할인", { category: "music" })).items).toEqual([]);
    expect((await search("할인", { period: "today" })).items).toEqual([]);
  });
  it("freezes pagination order and rechecks visibility; rejects changed filters and expired cursors", async () => {
    await seed(Array.from({ length: 60 }, (_, i) => fixture(`page${String(i).padStart(7, "0")}`, "축구 실수", { viewCount: 1000-i })));
    const first = await search("축구 실수");
    expect(first.items).toHaveLength(48);
    expect(first.totalCount).toBe(60);
    await seed([fixture("page9999999", "축구 실수", { viewCount: 99999 })]);
    const next = await search("축구 실수", { cursor: first.nextCursor });
    expect(next.items).toHaveLength(12);
    expect(next.totalCount).toBe(60);
    expect(next.items.some(v => first.items.some(w => w.videoId === v.videoId))).toBe(false);
    await db`update shorts_mvp.youtube_catalog set availability='unavailable' where video_id=${next.items[0].videoId}`;
    expect((await search("축구 실수", { cursor: first.nextCursor })).items).toHaveLength(11);
    await expect(search("요리", { cursor: first.nextCursor })).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    await expect(search("축구 실수", { category: "music", cursor: first.nextCursor })).rejects.toBeInstanceOf(CatalogCursorExpiredError);
    await db`update shorts_mvp.youtube_list_versions set expires_at=${new Date(now.getTime()-1000)}`;
    await expect(search("축구 실수", { cursor: first.nextCursor })).rejects.toBeInstanceOf(CatalogCursorExpiredError);
  });
  it("does not leak fuzzy threshold settings between requests", async () => {
    const before = await db`show pg_trgm.word_similarity_threshold`;
    await seed([fixture("setting0001", "손흥민")]);
    await search("손흥밍");
    expect(await db`show pg_trgm.word_similarity_threshold`).toEqual(before);
  });
  it("fills a page across removed ID batches and uses video ID to break equal-rank ties", async () => {
    await seed(Array.from({length:260},(_,i)=>fixture(`batch${String(i).padStart(6,"0")}`,"축구",{viewCount:100})));
    const first=await search("축구");
    expect(first.items[0].videoId).toBe("batch000000");
    await db`update shorts_mvp.youtube_catalog set availability='unavailable' where video_id<'batch000200'`;
    const next=await search("축구",{cursor:first.nextCursor});
    expect(next.items).toHaveLength(48);
    expect(next.items[0].videoId).toBe("batch000200");
    expect((await search("축구",{cursor:next.nextCursor})).items).toHaveLength(12);
  });
  it.runIf(process.env.POPULAR_SEARCH_BENCHMARK === "1")("measures bounded search performance on 70,000 catalog rows", async () => {
    await db`insert into shorts_mvp.youtube_catalog(id,video_id,metadata,availability,verified_at,first_discovered_at)
      select md5(i::text),lpad(i::text,11,'0'),jsonb_build_object(
        'videoId',lpad(i::text,11,'0'),'title',case when i%20=0 then '손흥민 축구 경기 하이라이트 ' when i%3=0 then '오늘의 요리 레시피 ' else '여행 음악 일상 이야기 ' end || i,
        'channelName','테스트채널 ' || (i%300),'category','sports','viewCount',i,'durationSeconds',600,
        'publishedAt','2026-01-01T00:00:00Z','license','youtube','isKorean',true),
        'public',${now},${now} from generate_series(1,70000) i`;
    await db.unsafe("vacuum analyze shorts_mvp.youtube_catalog");
    const results: Record<string, number[]> = {};
    for (const q of ["축구", "여행", "손흥밍", "테스트채널", "없는검색어"]) {
      results[q] = [];
      for (let i=0;i<6;i++) {
        const start=performance.now();
        await search(q);
        results[q].push(Math.round(performance.now()-start));
      }
    }
    const plan = await db.begin(async tx => {
      await tx`select set_config('pg_trgm.word_similarity_threshold','0.3',true)`;
      const expression=popularSearchSql(tx,"손흥밍");
      return tx`explain (analyze,buffers,format json) select c.id from shorts_mvp.youtube_catalog c
        where availability='public' and metadata is not null and video_id is not null and ${expression.match}`;
    });
    console.info("SEARCH_BENCHMARK_MS", JSON.stringify(results));
    console.info("SEARCH_INDEX_PLAN", JSON.stringify(plan));
    writeFileSync(path.join(tmpdir(), "easycut-search-benchmark.json"), JSON.stringify({ results, plan }, null, 2));
    expect(JSON.stringify(plan)).toContain("youtube_catalog_search_");
  }, 120000);
});
