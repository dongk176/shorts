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
  kstDate,
  validKstDate,
} from "@/lib/youtube-discovery-time";

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
  categoryRank?: number;
};
export async function saveCatalogPage(
  db: CatalogSql,
  items: CatalogVideo[],
  input: {
    runId?: string;
    trending?: boolean;
    observedAt: CatalogTimestamp;
    firstDiscoveredAt?: CatalogTimestamp;
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
    },
  }));
  await db`insert into shorts_mvp.youtube_catalog
    (id,video_id,metadata,first_discovered_at,verified_at,refresh_after,last_trending_at,trending_rank)
    select r.id,r.video_id,r.metadata,${catalogTimestamp(db,input.firstDiscoveredAt || input.observedAt)}::timestamptz,${catalogTimestamp(db,verifiedAt)}::timestamptz,
      ${catalogTimestamp(db,verifiedAt)}::timestamptz+interval '1 day',case when ${Boolean(input.trending)} then ${catalogTimestamp(db,input.observedAt)}::timestamptz end,case when ${Boolean(input.trending)} then r.rank end
    from jsonb_to_recordset(${db.json(records)}) as r(id text,video_id text,metadata jsonb,rank integer)
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
  if (input.trending) {
    if (input.runId)
      await db`insert into shorts_mvp.youtube_collection_run_days(run_id,day)
        values(${input.runId},${kstDate(new Date(input.observedAt))}) on conflict do nothing`;
    await db`insert into shorts_mvp.youtube_trending_days(day,catalog_id,first_seen_at,last_seen_at)
      select ${kstDate(new Date(input.observedAt))}::date,unnest(${records.map((r) => r.id)}::text[]),${catalogTimestamp(db,input.observedAt)}::timestamptz,${catalogTimestamp(db,input.observedAt)}::timestamptz
      on conflict(day,catalog_id) do update set
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
) {
  const [row] = await db`select
    (select max(finished_at) from shorts_mvp.youtube_collection_runs where status='success' and ((${type}='trending' and lane='trending') or (${type}='views' and lane='views') or (${type}='reusable' and lane<>'refresh'))) as collected_at,
    (select max(scheduled_at) from shorts_mvp.youtube_collection_runs
      where ${type !== "trending"} and lane=${type} and status='success'
        and finished_at<=${now}
        and scheduled_at<=${latestPublishableDiscoverySlot(now)}
        and (scheduled_at at time zone 'UTC')::time=time '08:10') as collection_window_start,
    (select max(verified_at) from shorts_mvp.youtube_catalog) as verified_at,
    (select max(updated_at) from shorts_mvp.youtube_catalog) as changed_at`;
  const updatedAt = row?.collectedAt
    ? new Date(row.collectedAt).toISOString()
    : null;
  const verifiedAt = row?.verifiedAt
    ? new Date(row.verifiedAt).toISOString()
    : null;
  // Until the first successful afternoon search, retain the existing catalog.
  // Failed/missing afternoon runs and successful morning runs cannot reset it.
  const collectionWindowStart = type === "trending" ? undefined
    : new Date(row?.collectionWindowStart || 0).toISOString();
  return {
    updatedAt,
    verifiedAt,
    collectionWindowStart,
    generation: `${updatedAt || ""}/${row?.changedAt ? new Date(row.changedAt).toISOString() : ""}${collectionWindowStart ? `/${collectionWindowStart}` : ""}`,
    delayed:
      !updatedAt || now.getTime() - Date.parse(updatedAt) >= 3 * 3_600_000,
  };
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
): Promise<CatalogVisibility[]> {
  const ids = [...new Set(videoIds)];
  if (ids.length > 200 || ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)))
    throw new Error("INVALID_VISIBILITY_IDS");
  if (!ids.length) return [];
  const rows = await db`select id,metadata->>'license' as license,
    (availability='public' and metadata is not null and video_id is not null and verified_at>${new Date(now.getTime() - 30 * DAY_MS)}) as available,
    coalesce(last_trending_at>${new Date(now.getTime() - DAY_MS)},false) as recent_trending,
    exists(select 1 from shorts_mvp.youtube_trending_run_items i where i.catalog_id=c.id
      and i.run_id=(select id from shorts_mvp.youtube_collection_runs where lane='trending' and status='success' order by finished_at desc limit 1)) as current_trending
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
  period: PopularDiscoveryPeriod;
  periodBasis?: "collected";
  date?: string;
  cursor?: string;
};
export async function getCatalogVideos(
  filters: CatalogFilters,
  db: Sql = getDb(),
  now = new Date(),
): Promise<PopularVideoResponse> {
  if (
    filters.date &&
    (filters.type !== "trending" || !validKstDate(filters.date, now))
  )
    throw new Error("INVALID_CATALOG_DATE");
  const collectedPeriod = filters.periodBasis === "collected" && !filters.date;
  const state = await catalogStatus(db, filters.type, now);
  const afternoonPeriod = collectedPeriod && filters.type !== "trending";
  const today = afternoonPeriod
    ? new Date(state.collectionWindowStart!) : discoverySince("today", now)!;
  const week = afternoonPeriod
    ? new Date(today.getTime() - 6 * DAY_MS) : discoverySince("week", now)!;
  const since = afternoonPeriod
    ? (filters.period === "all" ? null : filters.period === "today" ? today : week)
    : filters.type === "trending" && !collectedPeriod
      ? null : discoverySince(filters.period, now);
  const filterKey = JSON.stringify([
    filters.type,
    filters.category,
    filters.reusable,
    filters.longForm,
    filters.korean,
    filters.period,
    filters.date || null,
    filters.periodBasis || null,
    ...(afternoonPeriod ? ["afternoon-1720-v1", filters.period === "all" ? null : today.toISOString()] : []),
  ]);
  const [currentRun] =
    await db`select id from shorts_mvp.youtube_collection_runs
    where lane='trending' and status='success' order by finished_at desc limit 1`;
  const currentRunId = currentRun?.id || null;
  const reusable = filters.type === "reusable" || filters.reusable;
  const collectionTime = filters.type === "trending" && !reusable
    ? db`c.last_trending_at`
    : db`(select cr.last_collected_at from shorts_mvp.youtube_collection_recency cr where cr.catalog_id=c.id)`;
  const periodTime = collectedPeriod ? collectionTime : db`c.first_discovered_at`;
  const base = db`c.availability='public' and c.metadata is not null and c.video_id is not null
    and c.verified_at>${new Date(now.getTime() - 30 * DAY_MS)}
    and (${filters.category}='all' or c.metadata->>'category'=${filters.category})
    and (${filters.korean}=false or (c.metadata->>'isKorean')::boolean)
    and (${filters.longForm}=false or (c.metadata->>'durationSeconds')::int>=240)
    and (${reusable}=false or c.metadata->>'license'='creativeCommon')
    and (${filters.type !== "views" || reusable}=true or c.metadata->>'license'='youtube')
    and (${filters.type !== "trending"}=true or
      (${filters.date || null}::date is null and (
        (${collectedPeriod} and (${reusable} or c.last_trending_at is not null)) or
        (${!collectedPeriod} and c.last_trending_at>${new Date(now.getTime() - DAY_MS)})
      )) or
      exists(select 1 from shorts_mvp.youtube_trending_days d where d.catalog_id=c.id and d.day=${filters.date || null}::date))`;
  let versionId: string;
  let offset = 0;
  let collectedAt = state.updatedAt;
  if (filters.cursor) {
    let cursor: { id: string; offset: number };
    try {
      cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString());
      if (
        typeof cursor.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          cursor.id,
        ) ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0
      )
        throw new Error();
    } catch {
      throw new CatalogCursorExpiredError();
    }
    const [version] =
      await db`select id,collected_at from shorts_mvp.youtube_list_versions
      where id=${cursor.id} and filter_key=${filterKey} and expires_at>${now}`;
    if (!version) throw new CatalogCursorExpiredError();
    versionId = String(version.id);
    offset = cursor.offset;
    collectedAt = version.collectedAt
      ? new Date(version.collectedAt).toISOString()
      : null;
  } else {
    // Only IDs and their order are frozen. API metadata is always read from the canonical row.
    const [cached] =
      await db`select id from shorts_mvp.youtube_list_versions where filter_key=${filterKey}
      and generation=${state.generation} and expires_at>${now} and created_at>=${today}
      order by created_at desc limit 1`;
    const version =
      cached ||
      (
        await db`insert into shorts_mvp.youtube_list_versions(filter_key,generation,collected_at,catalog_ids)
      select ${filterKey},${state.generation},${state.updatedAt},coalesce(array_agg(id order by position),array[]::text[]) from (
        select c.id,row_number() over(order by
          case when ${filters.type === "trending" && !filters.date} and exists(
            select 1 from shorts_mvp.youtube_trending_run_items ri where ri.run_id=${currentRunId}::uuid and ri.catalog_id=c.id
          ) then 0 else 1 end,
          case when ${filters.type === "trending" && !filters.date} then c.trending_rank end asc nulls last,
          case when ${filters.type === "trending" && !filters.date} then c.last_trending_at end desc nulls last,
          (c.metadata->>'viewCount')::bigint desc,(c.metadata->>'publishedAt')::timestamptz desc,c.id) as position
        from shorts_mvp.youtube_catalog c where ${base}
          and (${since}::timestamptz is null or ${periodTime}>=${since})
      ) ranked returning id`
      )[0];
    versionId = String(version.id);
  }
  // Materialize IDs once. OFFSET 0 below preserves ID-first lookups even before
  // ANALYZE has statistics; otherwise a 50k catalog can trigger quadratic rescans.
  // Advance by the original ordinal, not the visible row count.
  const rows = await db`with entries as materialized (
      select entry.id,entry.ordinal from shorts_mvp.youtube_list_versions v
      cross join lateral unnest(v.catalog_ids) with ordinality entry(id,ordinal)
      where v.id=${versionId} and entry.ordinal>${offset}
    ) select c.metadata,c.verified_at,entry.ordinal,
    (${filters.type === "trending" && !filters.date && !state.delayed} and exists(
      select 1 from shorts_mvp.youtube_trending_run_items ri where ri.run_id=${currentRunId}::uuid and ri.catalog_id=c.id)) as is_current
    from entries entry cross join lateral (
      select c.* from shorts_mvp.youtube_catalog c where c.id=entry.id and ${base} offset 0
    ) c order by entry.ordinal limit 49`;
  const [counts] = await db`select count(*)::int as all_count,
    count(*) filter(where ${periodTime}>=${today})::int as today_count,
    count(*) filter(where ${periodTime}>=${week})::int as week_count
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
    updatedAt: collectedAt || "",
    verifiedAt: state.verifiedAt,
    generation: state.generation,
    ...(afternoonPeriod ? { collectionWindowStart: state.collectionWindowStart } : {}),
    delayed: state.delayed,
    version: versionId,
    catalogEnabled: true,
    date: filters.date || null,
    periodCounts,
    totalCount:
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
  const rows = await db`with days as (
    select d::date as day from generate_series(${`${month}-01`}::date,
      least((${`${month}-01`}::date+interval '1 month' - interval '1 day')::date,${kstDate(now)}::date),interval '1 day') d
    ), run_days as (
      select id as run_id,(started_at at time zone 'Asia/Seoul')::date as day
      from shorts_mvp.youtube_collection_runs where lane='trending'
        and started_at>=(${`${month}-01`}::date::timestamp at time zone 'Asia/Seoul')
        and started_at<((${`${month}-01`}::date+interval '1 month') at time zone 'Asia/Seoul')
      union
      select run_id,day from shorts_mvp.youtube_collection_run_days
        where day>=${`${month}-01`}::date and day<${`${month}-01`}::date+interval '1 month'
    ), records as (
      select d.day,count(*)::int as attempts,
        count(*) filter(where status='success')::int as successes,
        count(*) filter(where legacy)::int as legacy_attempts,
        bool_and(legacy) as legacy from run_days d join shorts_mvp.youtube_collection_runs r on r.id=d.run_id where lane='trending'
        group by 1
    ), members as (
      select d.day,count(*)::int as total,
        count(*) filter(where c.metadata is null or c.availability<>'public' or c.verified_at<=${new Date(now.getTime() - 30 * DAY_MS)})::int as unavailable
      from shorts_mvp.youtube_trending_days d join shorts_mvp.youtube_catalog c on c.id=d.catalog_id
      where d.day>=${`${month}-01`}::date and d.day<${`${month}-01`}::date+interval '1 month' group by 1
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
