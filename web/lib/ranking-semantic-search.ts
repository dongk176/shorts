import "server-only";
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { createShortEmbeddings } from "./short-video-embeddings.mjs";
import { popularSearchSql } from "./popular-text-search";
import { discoverySince } from "./youtube-discovery-time";
import { JAPANESE_TITLE_PATTERN, KOREAN_TITLE_PATTERN } from "./youtube-language";
import type { PopularVideo, PopularVideoResponse } from "./youtube-popular";
import { rankingSearchCursor, rankingSearchOffset, SEARCH_PAGE_SIZE, SEARCH_RESULT_LIMIT, type RankingSearchInput } from "./ranking-search-input";

export type RankingSearchResponse = PopularVideoResponse & { searchMode: "related" | "keyword" };
const queryVectors = new Map<string, {until: number; promise: Promise<number[]>}>();
async function queryVector(query: string, apiKey: string) {
  const key = createHash("sha256").update(query).digest("hex");
  const existing = queryVectors.get(key);
  if (existing && existing.until > Date.now()) return existing.promise;
  if (queryVectors.size >= 256) queryVectors.delete(queryVectors.keys().next().value!);
  const promise = createShortEmbeddings([query], {apiKey, timeoutMs: 6000}).then(result => result.vectors[0]);
  queryVectors.set(key, {until: Date.now() + 15 * 60_000, promise});
  try { return await promise; } catch (error) { queryVectors.delete(key); throw error; }
}
function eligible(db: Sql | TransactionSql, input: RankingSearchInput, now: Date) {
  const since = discoverySince(input.period, now);
  return db`c.availability='public' and c.video_id is not null and c.metadata is not null
    and c.verified_at>${new Date(now.getTime()-30*86400_000)}
    and (c.metadata->>'durationSeconds')::integer between 1 and 180
    and (${input.category}='all' or c.metadata->>'category'=${input.category})
    and (${!input.reusable} or c.metadata->>'license'='creativeCommon')
    and (${input.language !== 'ko'} or c.metadata->>'isKorean'='true')
    and (${input.language !== 'ja'} or (c.metadata->>'isJapanese'='true' and normalize(c.metadata->>'title',NFKC) !~ ${KOREAN_TITLE_PATTERN}))
    and (${input.language !== 'en'} or (c.metadata->>'isEnglish'='true' and normalize(c.metadata->>'title',NFKC) !~ ${KOREAN_TITLE_PATTERN} and normalize(c.metadata->>'title',NFKC) !~ ${JAPANESE_TITLE_PATTERN}))
    and (${input.period === 'all'} or exists(select 1 from shorts_mvp.youtube_catalog_regions r
      where r.catalog_id=c.id and r.last_collected_at>=${since}))`;
}
export async function searchRankingShortVideos(db: Sql, input: RankingSearchInput, options: {apiKey?: string; now?: Date; vector?: number[]} = {}): Promise<RankingSearchResponse> {
  const now = options.now ?? new Date();
  const offset = rankingSearchOffset(input);
  let vector: number[] | null = options.vector ?? null;
  const key = options.apiKey ?? process.env.RANKING_EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!vector && key && process.env.RANKING_SEMANTIC_SEARCH_ENABLED === "1") {
    try { vector = await queryVector(input.q, key); }
    catch { console.warn("ranking_semantic_fallback", {reason: "embedding_unavailable"}); }
  }
  let rows: {metadata: PopularVideo}[] | undefined;
  let mode: "related" | "keyword" = "keyword";
  if (vector) {
    try {
      rows = await db.begin(async tx => {
        await tx`set local statement_timeout='2500ms'`;
        await tx`set local hnsw.ef_search=100`;
        await tx`set local hnsw.iterative_scan='strict_order'`;
        await tx`set local hnsw.max_scan_tuples=10000`;
        const filter = eligible(tx,input,now);
        const keyword = popularSearchSql(tx,input.q);
        const encoded = JSON.stringify(vector);
        // Bound vector candidates before joining metadata. Joining the complete
        // catalog first can make Postgres sort every vector instead of using HNSW.
        return tx<{metadata: PopularVideo}[]>`with candidates as materialized (
          select e.catalog_id, e.embedding<=>${encoded}::public.vector as distance
          from shorts_mvp.short_video_embeddings e
          where e.embedding is not null and e.model='text-embedding-3-small' and e.version=1
          order by e.embedding<=>${encoded}::public.vector limit 1000
        ), nearest as materialized (
          select e.catalog_id,e.distance from candidates e
          join shorts_mvp.youtube_catalog c on c.id=e.catalog_id
          join shorts_mvp.short_video_embeddings stored on stored.catalog_id=e.catalog_id
          where ${filter}
            and stored.source_hash=md5(shorts_mvp.short_video_embedding_text(c.metadata))
          order by e.distance,e.catalog_id limit 160
        ), semantic as (
          select catalog_id, distance, row_number() over(order by distance,catalog_id) as position from nearest where distance<=0.68
        ), lexical_top as materialized (
          select c.id, ${keyword.tier} as tier, ${keyword.score} as score, (c.metadata->>'viewCount')::bigint as views
          from shorts_mvp.youtube_catalog c where ${filter} and ${keyword.match}
          order by tier,score desc,views desc,c.id limit 100
        ), lexical as (
          select id,tier,row_number() over(order by tier,score desc,views desc,id) as position from lexical_top
        ), ranked as (
          select coalesce(s.catalog_id,l.id) as id,
            coalesce((1.0-s.distance)/(20+s.position),0)+coalesce((case when l.tier<=1 then 0.2 else 0.02 end)/(20+l.position),0)
              +case l.tier when 0 then 1.0 when 1 then 0.15 else 0 end as relevance
          from semantic s full join lexical l on l.id=s.catalog_id
        ) select c.metadata from ranked r join shorts_mvp.youtube_catalog c on c.id=r.id
          order by r.relevance desc,(c.metadata->>'viewCount')::bigint desc,c.id
          limit ${Math.min(SEARCH_PAGE_SIZE+1,SEARCH_RESULT_LIMIT-offset)} offset ${offset}`;
      }) as unknown as {metadata: PopularVideo}[];
      mode = "related";
    } catch (error) { console.warn("ranking_semantic_fallback", {reason: "index_unavailable", code: error && typeof error === "object" && "code" in error ? String(error.code).slice(0,10) : "unknown"}); }
  }
  if (!rows) {
    const keyword = popularSearchSql(db,input.q);
    rows = await db<{metadata: PopularVideo}[]>`select c.metadata from shorts_mvp.youtube_catalog c
      where ${eligible(db,input,now)} and ${keyword.match}
      order by ${keyword.tier},${keyword.score} desc,(c.metadata->>'viewCount')::bigint desc,c.id
      limit ${Math.min(SEARCH_PAGE_SIZE+1,SEARCH_RESULT_LIMIT-offset)} offset ${offset}`;
  }
  const more = rows.length > SEARCH_PAGE_SIZE && offset+SEARCH_PAGE_SIZE<SEARCH_RESULT_LIMIT;
  const items = rows.slice(0,SEARCH_PAGE_SIZE).map(row => {
    const m = row.metadata;
    return {videoId:m.videoId,title:m.title,channelName:m.channelName,category:m.category,thumbnailUrl:m.thumbnailUrl,
      durationSeconds:m.durationSeconds,viewCount:m.viewCount,publishedAt:m.publishedAt,license:m.license};
  });
  return { items, updatedAt:now.toISOString(), searchMode:mode, nextCursor:more?rankingSearchCursor(input,offset+SEARCH_PAGE_SIZE):undefined };
}
