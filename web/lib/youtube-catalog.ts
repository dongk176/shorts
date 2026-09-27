import { normalizePopularQuery, popularSearchSql } from "@/lib/popular-text-search";
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { CatalogVisibility } from "@/lib/youtube-catalog-visibility";
import { getDb } from "@/lib/db";
import type {
  PopularVideo,
  PopularVideoResponse,
  PopularVideoType,
  PopularVideoCategory,
  PopularDiscoveryPeriod,
} from "@/lib/youtube-popular";
import {
  DAY_MS,
  discoverySince,
  latestPublishableDiscoverySlot,
  latestExpectedJapanSlot,
  kstDate,
  validKstDate,
} from "@/lib/youtube-discovery-time";

import { japanReadsEnabled } from "@/lib/youtube-japan-settings";

type CatalogSql = Sql | TransactionSql;
type CatalogTimestamp = Date | string;
// postgres.js serializes inferred timestamptz parameters through JS Date. Bind
// text explicitly and cast in SQL to retain original PostgreSQL microseconds.
export const catalogTimestamp = (db: CatalogSql, value: CatalogTimestamp) =>
  db.typed(value instanceof Date ? value.toISOString() : value, 25);
export const catalogId = (videoId: string) =>
  createHash("sha256").update(videoId).digest("hex");
export type CatalogVideo = PopularVideo & {
  isKorean: boolean;
  isJapanese?: boolean;
  isEnglish?: boolean;
  categoryRank?: number;
};
export async function saveCatalogPage(
  db: CatalogSql,
  items: CatalogVideo[],
  input: {
    runId?: string;
    regionCode?: "KR" | "JP";
    trending?: boolean;
    observedAt: CatalogTimestamp;
    firstDiscoveredAt?: CatalogTimestamp;
    firstDiscoveredAtByVideoId?: ReadonlyMap<string, CatalogTimestamp>;
    verifiedAt?: CatalogTimestamp;
  },
) {
  if (!items.length) return;
  const verifiedAt = input.verifiedAt || input.observedAt;
  const records = Array.from(
    new Map(items.map((item) => [item.videoId, item])).values(),
  ).map((item) => ({
    id: catalogId(item.videoId),
    video_id: item.videoId,
    rank: item.categoryRank || 1,
    first_discovered_at: input.firstDiscoveredAtByVideoId?.get(item.videoId)
      || input.firstDiscoveredAt || input.observedAt,
    metadata: {
      videoId: item.videoId,
      title: item.title,
      channelName: item.channelName,
      thumbnailUrl: item.thumbnailUrl,
      category: item.category,
      durationSeconds: item.durationSeconds,
      viewCount: item.viewCount,
      publishedAt: item.publishedAt,
      license: item.license,
      isKorean: item.isKorean,
      isJapanese: item.isJapanese ?? false,
      isEnglish: item.isEnglish ?? false,
      englishLanguageVersion: 4,
    },
  }));
  await db`insert into shorts_mvp.youtube_catalog
    (id,video_id,metadata,first_discovered_at,verified_at,refresh_after,last_trending_at,trending_rank)
    select r.id,r.video_id,r.metadata,r.first_discovered_at,${catalogTimestamp(db,verifiedAt)}::timestamptz,
      ${catalogTimestamp(db,verifiedAt)}::timestamptz+interval '1 day',case when ${Boolean(input.trending)} then ${catalogTimestamp(db,input.observedAt)}::timestamptz end,case when ${Boolean(input.trending)} then r.rank end
    from jsonb_to_recordset(${db.json(records)}) as r(id text,video_id text,metadata jsonb,rank integer,first_discovered_at timestamptz)
    on conflict(id) do update set
      first_discovered_at=least(youtube_catalog.first_discovered_at,excluded.first_discovered_at),
      video_id=case when excluded.verified_at>=greatest(youtube_catalog.verified_at,youtube_catalog.metadata_pending_at) then excluded.video_id else youtube_catalog.video_id end,
      metadata=case when excluded.verified_at>=greatest(youtube_catalog.verified_at,youtube_catalog.metadata_pending_at) then excluded.metadata else youtube_catalog.metadata end,
      availability=case when excluded.verified_at>=greatest(youtube_catalog.verified_at,youtube_catalog.metadata_pending_at) then 'public' else youtube_catalog.availability end,
      metadata_pending_at=case when excluded.verified_at>=youtube_catalog.metadata_pending_at then null else youtube_catalog.metadata_pending_at end,
      verified_at=greatest(youtube_catalog.verified_at,excluded.verified_at),updated_at=clock_timestamp(),
      refresh_after=greatest(youtube_catalog.refresh_after,excluded.refresh_after),refresh_lease_until=null,
      last_trending_at=greatest(youtube_catalog.last_trending_at,excluded.last_trending_at),
      trending_rank=case when excluded.last_trending_at>=youtube_catalog.last_trending_at or youtube_catalog.last_trending_at is null
        then coalesce(excluded.trending_rank,youtube_catalog.trending_rank) else youtube_catalog.trending_rank end`;
  const region = input.regionCode || "KR";
  const isCollection = db`exists(select 1 from shorts_mvp.youtube_collection_runs where id=${input.runId || null}::uuid and lane<>'refresh')`;
  // Refresh verifies shared metadata; it must not assign a Japanese-only video to Korea.
  await db`insert into shorts_mvp.youtube_catalog_regions
    (catalog_id,region_code,first_discovered_at,last_collected_at,last_trending_at,trending_rank)
    select r.id,${region},r.first_discovered_at,
      case when ${isCollection} then ${catalogTimestamp(db,input.observedAt)}::timestamptz end,
      case when ${Boolean(input.trending)} then ${catalogTimestamp(db,input.observedAt)}::timestamptz end,
      case when ${Boolean(input.trending)} then r.rank end
    from jsonb_to_recordset(${db.json(records)}) r(id text,rank integer,first_discovered_at timestamptz)
    where ${isCollection} or ${Boolean(input.trending)} or not exists(select 1 from shorts_mvp.youtube_catalog_regions existing where existing.catalog_id=r.id)
    on conflict(catalog_id,region_code) do update set
      first_discovered_at=least(youtube_catalog_regions.first_discovered_at,excluded.first_discovered_at),
      last_collected_at=greatest(youtube_catalog_regions.last_collected_at,excluded.last_collected_at),
      last_trending_at=greatest(youtube_catalog_regions.last_trending_at,excluded.last_trending_at),
      trending_rank=case when excluded.last_trending_at>=youtube_catalog_regions.last_trending_at or youtube_catalog_regions.last_trending_at is null
        then coalesce(excluded.trending_rank,youtube_catalog_regions.trending_rank) else youtube_catalog_regions.trending_rank end`;
  if (input.trending) {
    if (input.runId)
      await db`insert into shorts_mvp.youtube_collection_run_days(run_id,day)
        values(${input.runId},${kstDate(new Date(input.observedAt))}) on conflict do nothing`;
    await db`insert into shorts_mvp.youtube_trending_days(day,catalog_id,first_seen_at,last_seen_at,region_code)
      select ${kstDate(new Date(input.observedAt))}::date,unnest(${records.map((r) => r.id)}::text[]),${catalogTimestamp(db,input.observedAt)}::timestamptz,${catalogTimestamp(db,input.observedAt)}::timestamptz,${region}
      on conflict(day,catalog_id,region_code) do update set
        first_seen_at=least(youtube_trending_days.first_seen_at,excluded.first_seen_at),
        last_seen_at=greatest(youtube_trending_days.last_seen_at,excluded.last_seen_at)`;
  }
  if (input.runId)
    await db`insert into shorts_mvp.youtube_trending_run_items(run_id,catalog_id)
    select ${input.runId}::uuid,unnest(${records.map((r) => r.id)}::text[]) on conflict do nothing`;
  if (input.runId)
    await db`insert into shorts_mvp.youtube_collection_recency(catalog_id,last_collected_at)
      select unnest(${records.map(r => r.id)}::text[]),${catalogTimestamp(db,input.observedAt)}::timestamptz
      from shorts_mvp.youtube_collection_runs where id=${input.runId} and lane<>'refresh'
      on conflict(catalog_id) do update set last_collected_at=greatest(youtube_collection_recency.last_collected_at,excluded.last_collected_at)`;
}

/** Preserve a confirmed public identifier for a bounded retry, without storing
 * incomplete API metadata or extending its full-verification freshness clock. */
export async function markCatalogMetadataPending(
  db: CatalogSql, videoIds: string[], observedAt: CatalogTimestamp,
  checkedAt: CatalogTimestamp = new Date(),
) {
  if (!videoIds.length) return;
  const records = videoIds.map(videoId => ({ id: catalogId(videoId), video_id: videoId }));
  await db`insert into shorts_mvp.youtube_catalog(id,video_id,first_discovered_at,verified_at,metadata_pending_at,refresh_after)
    select r.id,r.video_id,${catalogTimestamp(db,observedAt)}::timestamptz,${catalogTimestamp(db,observedAt)}::timestamptz,
      ${catalogTimestamp(db,checkedAt)}::timestamptz,${catalogTimestamp(db,checkedAt)}::timestamptz+interval '1 hour'
    from jsonb_to_recordset(${db.json(records)}) r(id text,video_id text)
    on conflict(id) do update set
      first_discovered_at=least(youtube_catalog.first_discovered_at,excluded.first_discovered_at),
      video_id=excluded.video_id,metadata=null,availability='public',metadata_pending_at=excluded.metadata_pending_at,
      refresh_after=excluded.refresh_after,refresh_lease_until=null,updated_at=clock_timestamp()
    where excluded.metadata_pending_at>=greatest(youtube_catalog.verified_at,youtube_catalog.metadata_pending_at)`;
}

export async function catalogStatus(
  db: CatalogSql = getDb(),
  type: PopularVideoType = "trending",
  now = new Date(),
  japanScope?: boolean,
) {
  const includeJapan = japanScope ?? await japanReadsEnabled(db);
  const [row] = await db`select
    (select max(finished_at) from shorts_mvp.youtube_collection_runs where status='success' and finished_at<=${now}
      and (region_code='KR' or ${includeJapan}) and ((${type}='trending' and lane='trending') or (${type}='views' and lane='views') or (${type}='reusable' and lane<>'refresh'))) as collected_at,
    (select max(scheduled_at) from shorts_mvp.youtube_collection_runs
      where ${type !== "trending"} and lane=${type} and region_code='KR' and status='success' and finished_at<=${now}
        and scheduled_at<=${latestPublishableDiscoverySlot(now)} and (scheduled_at at time zone 'UTC')::time=time '08:10') as kr_window,
    (select max(scheduled_at) from shorts_mvp.youtube_collection_runs
      where ${type !== "trending" && includeJapan} and lane=${type} and region_code='JP' and status='success' and finished_at<=${now}
        and scheduled_at<=${latestPublishableDiscoverySlot(now,"JP")} and (scheduled_at at time zone 'UTC')::time=time '08:15') as jp_window,
    (select max(finished_at) from shorts_mvp.youtube_collection_runs where lane='trending' and region_code='KR' and status='success' and finished_at<=${now}) as kr_trending,
    (select max(scheduled_at) from shorts_mvp.youtube_collection_runs where lane='trending' and region_code='JP' and status='success' and finished_at<=${now}) as jp_trending,
    (select max(verified_at) from shorts_mvp.youtube_catalog) as verified_at,
    (select max(updated_at) from shorts_mvp.youtube_catalog) as changed_at`;
  const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
  const updatedAt = iso(row?.collectedAt);
  const verifiedAt = iso(row?.verifiedAt);
  const collectionWindowStart = type === "trending" ? undefined : iso(row?.krWindow) || new Date(0).toISOString();
  const collectionWindows = type === "trending" ? undefined : {
    KR: collectionWindowStart!, ...(includeJapan ? { JP: iso(row?.jpWindow) || new Date(0).toISOString() } : {}),
  };
  const collectionWindowKey = JSON.stringify([includeJapan, collectionWindows || null]);
  const regionDelayed = {
    KR: !row?.krTrending || now.getTime() - new Date(row.krTrending).getTime() >= 3 * 3_600_000,
    ...(includeJapan ? { JP: !row?.jpTrending || new Date(row.jpTrending) < latestExpectedJapanSlot(now) } : {}),
  };
  return {
    updatedAt, verifiedAt, collectionWindowStart, collectionWindows, collectionWindowKey, regionDelayed,
    japaneseEnabled: includeJapan,
    generation: `${updatedAt || ""}/${iso(row?.changedAt) || ""}/${collectionWindowKey}`,
    delayed: type === "trending" ? regionDelayed.KR && (!includeJapan || regionDelayed.JP === true)
      : !updatedAt || now.getTime() - Date.parse(updatedAt) >= 3 * 3_600_000,
  };
}

function freshTrendingCondition(db: CatalogSql, now: Date) {
  return db`((active.region_code='KR' and active.finished_at>${new Date(now.getTime()-3*3_600_000)})
    or (active.region_code='JP' and active.scheduled_at>=${latestExpectedJapanSlot(now)}))`;
}

export class CatalogCursorExpiredError extends Error {
  constructor() {
    super("목록 유효기간이 지나 첫 페이지를 다시 불러옵니다.");
    this.name = "CatalogCursorExpiredError";
  }
}

/** DB-only checks for cards already on screen. Never expose unavailable metadata. */
export async function getCatalogVisibility(
  videoIds: string[],
  db: CatalogSql = getDb(),
  now = new Date(),
  japanScope?: boolean,
): Promise<CatalogVisibility[]> {
  const ids = [...new Set(videoIds)];
  if (ids.length > 200 || ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)))
    throw new Error("INVALID_VISIBILITY_IDS");
  if (!ids.length) return [];
  const includeJapan = japanScope ?? await japanReadsEnabled(db);
  const regionalTrendingAt = db`coalesce((select max(r.last_trending_at) from shorts_mvp.youtube_catalog_regions r
    where r.catalog_id=c.id and (r.region_code='KR' or ${includeJapan})),
    case when not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id) then c.last_trending_at end)`;
  const rows = await db`select id,metadata->>'license' as license,
    ((exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and (r.region_code='KR' or ${includeJapan})) or not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id)) and availability='public' and metadata is not null and video_id is not null and verified_at>${new Date(now.getTime() - 30 * DAY_MS)}) as available,
    coalesce(${regionalTrendingAt}>${new Date(now.getTime() - DAY_MS)},false) as recent_trending,
    exists(select 1 from shorts_mvp.youtube_trending_run_items i where i.catalog_id=c.id
      and i.run_id in (select distinct on(region_code) id from shorts_mvp.youtube_collection_runs where lane='trending' and status='success' and (region_code='KR' or ${includeJapan}) order by region_code,finished_at desc)
      and exists(select 1 from shorts_mvp.youtube_collection_runs active where active.id=i.run_id and ${freshTrendingCondition(db,now)})) as current_trending
    from shorts_mvp.youtube_catalog c where id in ${db(ids.map(catalogId))}`;
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids.map((videoId) => {
    const row = byId.get(catalogId(videoId));
    const available = Boolean(row?.available);
    return {
      videoId,
      available,
      license:
        available && row ? (row.license as "youtube" | "creativeCommon") : null,
      recentTrending: Boolean(row?.recentTrending),
      currentTrending: available && Boolean(row?.currentTrending),
    };
  });
}
export type CatalogFilters = {
  type: PopularVideoType;
  category: PopularVideoCategory;
  reusable: boolean;
  longForm: boolean;
  korean: boolean;
  japanese?: boolean;
  english?: boolean;
  period: PopularDiscoveryPeriod;
  periodBasis?: "collected";
  date?: string;
  cursor?: string;
  q?: string;
};
/** Keep the fuzzy threshold scoped to this transaction, including count and page queries. */
export async function searchCatalogVideos(
  filters: CatalogFilters & { q: string }, db: Sql = getDb(), now = new Date(),
): Promise<PopularVideoResponse> {
  return db.begin(async tx => {
    await tx`select set_config('pg_trgm.word_similarity_threshold','0.3',true)`;
    return getCatalogVideos({ ...filters, type: "views", date: undefined }, tx, now);
  }) as Promise<PopularVideoResponse>;
}

export async function getCatalogVideos(
  filters: CatalogFilters,
  db: CatalogSql = getDb(),
  now = new Date(),
): Promise<PopularVideoResponse> {
  if (
    filters.date &&
    (filters.type !== "trending" || !validKstDate(filters.date, now))
  )
    throw new Error("INVALID_CATALOG_DATE");
  const search = filters.q ? popularSearchSql(db, filters.q) : null;
  const collectedPeriod = filters.periodBasis === "collected" && !filters.date;
  const exposedJapan = await japanReadsEnabled(db);
  let includeJapan = exposedJapan;
  const state = await catalogStatus(db, filters.type, now, exposedJapan);
  const afternoonPeriod = collectedPeriod && filters.type !== "trending";
  const today = afternoonPeriod ? new Date(state.collectionWindowStart!) : discoverySince("today", now)!;
  const week = new Date(today.getTime() - 6 * DAY_MS);
  const legacyFilterKey = JSON.stringify([
    filters.type, filters.category, filters.reusable, filters.longForm, filters.korean,
    filters.period, filters.date || null, filters.periodBasis || null,
    ...(afternoonPeriod ? ["afternoon-1720-v1", filters.period === "all" ? null : today.toISOString()] : []),
  ]);
  const regionalFilterKey = exposedJapan || filters.japanese
    ? JSON.stringify([...JSON.parse(legacyFilterKey), "regions-v2", Boolean(filters.japanese), exposedJapan,
      afternoonPeriod && filters.period !== "all" ? state.collectionWindowKey : null]) : legacyFilterKey;
  const baseFilterKey = filters.english ? JSON.stringify(["english-v1", regionalFilterKey]) : regionalFilterKey;
  const filterKey = search ? JSON.stringify(["text-search-v1", normalizePopularQuery(filters.q!), baseFilterKey]) : baseFilterKey;
  let requestedVersion: { id: string; collectedAt: Date | null; currentRunIds: string[]; filterKey: string } | undefined;
  let cursorOffset = 0;
  if (filters.cursor) {
    let cursor: { id: string; offset: number };
    try {
      cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString());
      if (typeof cursor.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor.id)
        || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
    } catch { throw new CatalogCursorExpiredError(); }
    const [version] = await db`select id,collected_at,current_run_ids,filter_key from shorts_mvp.youtube_list_versions
      where id=${cursor.id} and expires_at>${now} and (filter_key=${filterKey} or (${!search && !filters.japanese && !filters.english} and filter_key=${legacyFilterKey}))`;
    if (!version) throw new CatalogCursorExpiredError();
    requestedVersion = version as typeof requestedVersion;
    if (version.filterKey === legacyFilterKey) includeJapan = false;
    cursorOffset = cursor.offset;
  }
  const currentRuns = await db`select distinct on(region_code) id from shorts_mvp.youtube_collection_runs
    where lane='trending' and status='success' and finished_at<=${now} and (region_code='KR' or ${includeJapan})
    order by region_code,finished_at desc,id`;
  let currentRunIds = currentRuns.map(run => String(run.id));

  const reusable = filters.type === "reusable" || filters.reusable;
  const regionScope = db`(r.region_code='KR' or ${includeJapan})`;
  const regionalTrendingAt = db`coalesce((select max(r.last_trending_at) from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and ${regionScope}),
    case when not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id) then c.last_trending_at end)`;
  const regionalRank = db`coalesce((select min(r.trending_rank) from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and ${regionScope}),c.trending_rank)`;
  const regionMembership = db`(exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and ${regionScope})
    or not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id))`;
  const collectionTime = filters.type === "trending" && !reusable
    ? regionalTrendingAt
    : db`coalesce((select max(r.last_collected_at) from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and ${regionScope}),(select cr.last_collected_at from shorts_mvp.youtube_collection_recency cr where cr.catalog_id=c.id))`;
  const periodTime = collectedPeriod ? collectionTime : db`c.first_discovered_at`;
  const periodMatch = (period: "all" | "today" | "week") => {
    if (period === "all") return db`true`;
    if (!afternoonPeriod) return db`${periodTime}>=${period === "today" ? today : week}`;
    const krSince = new Date(today.getTime() - (period === "week" ? 6 * DAY_MS : 0));
    const jpSince = new Date(Date.parse(state.collectionWindows?.JP || new Date(0).toISOString()) - (period === "week" ? 6 * DAY_MS : 0));
    return db`(exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and ${regionScope}
      and r.last_collected_at>=case when r.region_code='KR' then ${krSince}::timestamptz else ${jpSince}::timestamptz end)
      or (not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id)
        and ${collectionTime}>=${krSince}))`;
  };
  const base = db`${search?.match ?? db`true`} and ${regionMembership} and c.availability='public' and c.metadata is not null and c.video_id is not null
    and c.verified_at>${new Date(now.getTime() - 30 * DAY_MS)}
    and (${filters.category}='all' or c.metadata->>'category'=${filters.category})
    and (${filters.japanese ?? false}=false or coalesce((c.metadata->>'isJapanese')::boolean,false))
    and (${filters.english ?? false}=false or coalesce((c.metadata->>'isEnglish')::boolean,false))
    and (${filters.korean}=false or (c.metadata->>'isKorean')::boolean)
    and (${filters.longForm}=false or (c.metadata->>'durationSeconds')::int>=240)
    and (${reusable}=false or c.metadata->>'license'='creativeCommon')
    and (${Boolean(search) || filters.type !== "views" || reusable}=true or c.metadata->>'license'='youtube')
    and (${Boolean(search) || filters.type !== "trending"}=true or
      (${filters.date || null}::date is null and (
        (${collectedPeriod} and (${reusable} or ${regionalTrendingAt} is not null)) or
        (${!collectedPeriod} and ${regionalTrendingAt}>${new Date(now.getTime() - DAY_MS)})
      )) or
      exists(select 1 from shorts_mvp.youtube_trending_days d where d.catalog_id=c.id and d.day=${filters.date || null}::date and (d.region_code='KR' or ${includeJapan})))`;
  let versionId: string;
  let offset = 0;
  let collectedAt = state.updatedAt;
  if (requestedVersion) {
    if (requestedVersion.currentRunIds.length) currentRunIds = requestedVersion.currentRunIds;
    versionId = requestedVersion.id;
    offset = cursorOffset;
    collectedAt = requestedVersion.collectedAt ? new Date(requestedVersion.collectedAt).toISOString() : null;
  } else {
    // Only IDs and their order are frozen. API metadata is always read from the canonical row.
    const [cached] =
      await db`select id,current_run_ids from shorts_mvp.youtube_list_versions where filter_key=${filterKey}
      and generation=${state.generation} and expires_at>${now} and created_at>=${today}
      order by created_at desc limit 1`;
    const version =
      cached ||
      (
        await db`insert into shorts_mvp.youtube_list_versions(filter_key,generation,collected_at,current_run_ids,expires_at,catalog_ids)
      select ${filterKey},${state.generation},${state.updatedAt},${currentRunIds}::uuid[],${new Date(now.getTime() + (search ? 15 * 60_000 : 48 * 3_600_000))},coalesce(array_agg(id order by position),array[]::text[]) from (
        select c.id,row_number() over(order by
          ${search?.tier ?? db`0`} asc, ${search?.score ?? db`0`} desc,
          case when ${filters.type === "trending" && !filters.date} and exists(
            select 1 from shorts_mvp.youtube_trending_run_items ri where ri.run_id=any(${currentRunIds}::uuid[]) and ri.catalog_id=c.id
          ) then 0 else 1 end,
          case when ${filters.type === "trending" && !filters.date} then ${regionalRank} end asc nulls last,
          case when ${filters.type === "trending" && !filters.date} then ${regionalTrendingAt} end desc nulls last,
          (c.metadata->>'viewCount')::bigint desc,(c.metadata->>'publishedAt')::timestamptz desc,
          case when ${Boolean(search)} then c.video_id else c.id end) as position
        from shorts_mvp.youtube_catalog c where ${base}
          and ${filters.type === "trending" && !collectedPeriod ? db`true` : periodMatch(filters.period)}
      ) ranked returning id,current_run_ids`
      )[0];
    versionId = String(version.id);
    currentRunIds = version.currentRunIds;
  }
  // Materialize IDs once. OFFSET 0 below preserves ID-first lookups even before
  // ANALYZE has statistics; otherwise a 50k catalog can trigger quadratic rescans.
  // Advance by the original ordinal, not the visible row count.
  const [searchCount] = search ? await db`select cardinality(catalog_ids)::int as all_count from shorts_mvp.youtube_list_versions where id=${versionId}` : [];
  const searchPageBatch = 192;
  const readPage = (batchOffset: number, limit: number) => db`with entries as materialized (
      select entry.id,entry.ordinal+${search ? batchOffset : 0} as ordinal from shorts_mvp.youtube_list_versions v
      cross join lateral unnest(${search ? db`v.catalog_ids[${batchOffset + 1}:${batchOffset + searchPageBatch}]` : db`v.catalog_ids`}) with ordinality entry(id,ordinal)
      where v.id=${versionId} and (${Boolean(search)} or entry.ordinal>${batchOffset})
    ) select c.metadata,c.verified_at,entry.ordinal,
    ${search ? db`(${search.tier}=3)` : db`false`} as similar_match,
    (${filters.type === "trending" && !filters.date} and exists(
      select 1 from shorts_mvp.youtube_trending_run_items ri join shorts_mvp.youtube_collection_runs active on active.id=ri.run_id
      where ri.run_id=any(${currentRunIds}::uuid[]) and ri.catalog_id=c.id and ${freshTrendingCondition(db,now)})) as is_current
    from entries entry cross join lateral (
      select c.* from shorts_mvp.youtube_catalog c where c.id=entry.id and ${base} offset 0
    ) c order by entry.ordinal limit ${limit}`;
  const rows = await readPage(offset, 49);
  if (search) {
    // Small ID slices prevent common queries from rechecking tens of thousands
    // of rows just to serve 48 cards. Scan further only if safety filters removed rows.
    for (let batchOffset=offset+searchPageBatch; rows.length<49 && batchOffset<Number(searchCount.allCount); batchOffset+=searchPageBatch) {
      rows.push(...await readPage(batchOffset,49-rows.length));
    }
  }
  // Search counts belong to the frozen result set. Avoid re-running the entire
  // fuzzy query on every page (and counting newly collected videos outside it).
  const [counts] = search
    ? [searchCount]
    : await db`select count(*)::int as all_count,
    count(*) filter(where ${periodMatch("today")})::int as today_count,
    count(*) filter(where ${periodMatch("week")})::int as week_count
    from shorts_mvp.youtube_catalog c where ${base}`;
  const periodCounts = {
    all: Number(counts.allCount),
    today: Number(counts.todayCount),
    week: Number(counts.weekCount),
  };
  const calendar = filters.date
    ? await getTrendingCalendar(filters.date.slice(0, 7), db, now)
    : null;
  const day = calendar?.days.find((entry) => entry.date === filters.date);
  return {
    items: rows.slice(0, 48).map((row) => ({
      ...row.metadata,
      verifiedAt: new Date(row.verifiedAt).toISOString(),
      isCurrentTrending: Boolean(row.isCurrent),
    })),
    ...(search ? { includesSimilarResults: rows.slice(0, 48).some(row => row.similarMatch) } : {}),
    updatedAt: collectedAt || "",
    verifiedAt: state.verifiedAt,
    generation: state.generation,
    ...(afternoonPeriod ? { collectionWindowStart: state.collectionWindowStart } : {}),
    delayed: state.delayed,
    version: versionId,
    catalogEnabled: true,
    japaneseEnabled: exposedJapan,
    collectionWindowKey: state.collectionWindowKey,
    collectionWindows: state.collectionWindows,
    date: filters.date || null,
    ...(search ? {} : { periodCounts }),
    totalCount: search ? Number(counts.allCount) :
      periodCounts[filters.type === "trending" && !collectedPeriod ? "all" : filters.period],
    collectionStatus: day?.status,
    unavailableCount: day?.unavailableCount,
    ...(rows.length > 48
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ id: versionId, offset: Number(rows[47].ordinal) }),
          ).toString("base64url"),
        }
      : {}),
  };
}

export async function getTrendingCalendar(
  month: string,
  db: CatalogSql = getDb(),
  now = new Date(),
) {
  if (!/^\d{4}-\d{2}$/.test(month) || !validKstDate(`${month}-01`, now))
    throw new Error("INVALID_CALENDAR_MONTH");
  const includeJapan = await japanReadsEnabled(db);
  const rows = await db`with days as (
    select d::date as day from generate_series(${`${month}-01`}::date,
      least((${`${month}-01`}::date+interval '1 month' - interval '1 day')::date,${kstDate(now)}::date),interval '1 day') d
    ), run_days as (
      select id as run_id,(started_at at time zone 'Asia/Seoul')::date as day
      from shorts_mvp.youtube_collection_runs where lane='trending' and (region_code='KR' or ${includeJapan})
        and started_at>=(${`${month}-01`}::date::timestamp at time zone 'Asia/Seoul')
        and started_at<((${`${month}-01`}::date+interval '1 month') at time zone 'Asia/Seoul')
      union
      select run_id,day from shorts_mvp.youtube_collection_run_days
        where day>=${`${month}-01`}::date and day<${`${month}-01`}::date+interval '1 month'
    ), records as (
      select d.day,count(*)::int as attempts,
        count(*) filter(where status='success')::int as successes,
        count(*) filter(where legacy)::int as legacy_attempts,
        bool_and(legacy) as legacy from run_days d join shorts_mvp.youtube_collection_runs r on r.id=d.run_id where lane='trending' and (r.region_code='KR' or ${includeJapan})
        group by 1
    ), members as (
      select d.day,count(distinct c.id)::int as total,
        count(distinct c.id) filter(where c.metadata is null or c.availability<>'public' or c.verified_at<=${new Date(now.getTime() - 30 * DAY_MS)})::int as unavailable
      from shorts_mvp.youtube_trending_days d join shorts_mvp.youtube_catalog c on c.id=d.catalog_id
      where (d.region_code='KR' or ${includeJapan}) and d.day>=${`${month}-01`}::date and d.day<${`${month}-01`}::date+interval '1 month' group by 1
    ) select days.day::text,coalesce(r.attempts,0)::int as attempts,coalesce(r.successes,0)::int as successes,
      coalesce(r.legacy,false) as legacy,coalesce(r.legacy_attempts,0)::int as legacy_attempts,
      coalesce(m.total,0)::int as total,coalesce(m.unavailable,0)::int as unavailable,
      (select min(expanded_at) from shorts_mvp.youtube_quota_verifications) as expanded_at
    from days left join records r on r.day=days.day left join members m on m.day=days.day order by days.day`;
  return {
    month,
    today: kstDate(now),
    days: rows.map((row) => {
      let expected = Number(row.attempts);
      if (row.expandedAt) {
        const start = new Date(`${row.day}T00:00:00+09:00`).getTime();
        const enabled = new Date(row.expandedAt).getTime();
        expected = Math.max(
          expected,
          Number(row.legacyAttempts) + Array.from(
            { length: 12 },
            (_, i) => start + (1 + 2 * i) * 3_600_000,
          ).filter((t) => t >= enabled && t <= now.getTime()).length,
        );
      }
      return {
        date: String(row.day),
        collections: Number(row.attempts),
        successfulCollections: Number(row.successes),
        legacy: Boolean(row.legacy),
        totalCount: Number(row.total),
        unavailableCount: Number(row.unavailable),
        status:
          !row.attempts && !row.total
            ? ("none" as const)
            : !row.attempts || Number(row.successes) < expected
              ? ("partial" as const)
              : ("complete" as const),
      };
    }),
  };
}

export async function purgeExpiredCatalog(db: Sql = getDb(), now = new Date()) {
  await db.begin(async (tx) => {
    // Internal hash membership survives; expired API identifiers and payload do not.
    const expired =
      await tx`update shorts_mvp.youtube_catalog set metadata=null,video_id=null,availability='expired',trending_rank=null,updated_at=clock_timestamp()
      where greatest(verified_at,metadata_pending_at)<=${new Date(now.getTime() - 30 * DAY_MS)}
        and (metadata is not null or video_id is not null) returning id`;
    if (expired.length) {
      const { refreshCatalogViewCounter } = await import(
        "@/lib/reusable-view-counter-server"
      );
      await tx
        .savepoint((counterDb) => refreshCatalogViewCounter(counterDb, now))
        .catch(() => console.error("youtube_catalog_counter_refresh_failed"));
    }
    await tx`update shorts_mvp.youtube_catalog_regions set trending_rank=null where last_trending_at<${new Date(now.getTime() - DAY_MS)}`;
    await tx`update shorts_mvp.youtube_catalog set trending_rank=null where last_trending_at<${new Date(now.getTime() - DAY_MS)}`;
    await tx`update shorts_mvp.youtube_search_positions set page_token=null where updated_at<${new Date(now.getTime() - 25 * DAY_MS)}`;
    await tx`delete from shorts_mvp.youtube_list_versions where expires_at<=${now}`;
    await tx`delete from shorts_mvp.youtube_trending_run_items where run_id in (
      select id from shorts_mvp.youtube_collection_runs where finished_at<${new Date(now.getTime() - 2 * DAY_MS)})`;
    await tx`delete from shorts_mvp.youtube_analyses where expires_at<${now}`;
  });
}

export async function markCatalogUnavailable(
  db: CatalogSql,
  videoIds: string[],
  checkedAt: CatalogTimestamp,
) {
  if (!videoIds.length) return [];
  return await db`update shorts_mvp.youtube_catalog set metadata=null,video_id=null,availability='unavailable',
    trending_rank=null,metadata_pending_at=null,verified_at=${catalogTimestamp(db,checkedAt)}::timestamptz,updated_at=clock_timestamp(),refresh_lease_until=null
    where id in ${db(videoIds.map(catalogId))} and greatest(verified_at,metadata_pending_at)<=${catalogTimestamp(db,checkedAt)}::timestamptz returning id`;
}

/** A source analysis can confirm a license/status change without rechecking views.
 * Do not extend the full metadata's 30-day freshness clock for this partial check. */
export async function recordCatalogAnalysisStatus(
  db: Sql,
  videoId: string,
  status: { privacyStatus: string; license?: string } | null,
) {
  await db.begin(async (tx) => {
    let changed = false;
    if (!status || status.privacyStatus !== "public") {
      changed =
        (await markCatalogUnavailable(tx, [videoId], new Date())).length > 0;
    } else if (
      status.license === "creativeCommon" ||
      status.license === "youtube"
    ) {
      const rows =
        await tx`update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{license}',to_jsonb(${status.license}::text)),updated_at=clock_timestamp()
        where video_id=${videoId} and metadata is not null and metadata->>'license'<>${status.license} returning id`;
      changed = rows.length > 0;
    }
    if (!changed) return;
    const { refreshCatalogViewCounter } = await import(
      "@/lib/reusable-view-counter-server"
    );
    await refreshCatalogViewCounter(tx, new Date());
  });
}
