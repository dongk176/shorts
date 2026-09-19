import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import {
  catalogId,
  markCatalogUnavailable,
  markCatalogMetadataPending,
  saveCatalogPage,
  type CatalogVideo,
} from "@/lib/youtube-catalog";
import { discoverySlot, DAY_MS, kstDate } from "@/lib/youtube-discovery-time";
import {
  withYoutubePurpose,
  YoutubeQuotaError,
  type YoutubePurpose,
} from "@/lib/youtube-quota";
import {
  FREE_SEARCH_QUERIES,
  InvalidSearchPageTokenError,
  verifiedCatalogDetails,
  requestFreeSearchPage,
  requestVideoDetails,
  type SearchVideoSource,
} from "@/lib/youtube-free";
import {
  normalizePage,
  popularVideoSourceCategories,
  requestPopularPage,
  POPULAR_VIDEO_CATEGORY_PAGE_LIMIT,
} from "@/lib/youtube-popular";
import { POPULAR_SEARCH_QUERIES } from "@/lib/youtube-popular-search";
import { refreshCatalogViewCounter } from "@/lib/reusable-view-counter-server";

export type DiscoveryLane = Exclude<YoutubePurpose, "analysis" | "refresh">;
type SearchTask = {
  key: string;
  source: SearchVideoSource;
  continuation?: boolean;
};
export function discoverySearchTasks(
  lane: Exclude<DiscoveryLane, "trending">,
  scheduledAt: Date,
  legacy = false,
): SearchTask[] {
  const publishedAfter = new Date(scheduledAt.getTime() - 7 * DAY_MS);
  if (lane === "free")
    return FREE_SEARCH_QUERIES.map((query) => ({
      key: `free:${query}`,
      source: { query, publishedAfter },
    }));
  if (lane === "views") {
    const half = scheduledAt.getUTCHours() >= 20 ? 0 : 1;
    return (
      legacy
        ? POPULAR_SEARCH_QUERIES
        : POPULAR_SEARCH_QUERIES.slice(half * 20, half * 20 + 20)
    ).map((query) => ({
      key: `views:${query}`,
      source: { query, publishedAfter },
    }));
  }
  const categories = popularVideoSourceCategories;
  const rotation =
    Math.floor(scheduledAt.getTime() / (12 * 3_600_000)) % categories.length;
  const rotated = [
    ...categories.slice(rotation),
    ...categories.slice(0, rotation),
  ];
  return [
    ...rotated.map((category) => ({
      key: `cc:category:${category.videoCategoryId}`,
      source: {
        videoCategoryId: category.videoCategoryId,
        publishedAfter: null,
      },
      continuation: true,
    })),
    ...rotated.slice(0, 3).map((category) => ({
      key: `cc:recent:${category.videoCategoryId}`,
      source: { videoCategoryId: category.videoCategoryId, publishedAfter },
    })),
  ];
}

export async function claimRun(
  db: Sql,
  lane: DiscoveryLane | "refresh",
  scheduledAt: Date,
  legacy: boolean,
  regionCode: "KR" | "JP" = "KR",
) {
  return db.begin(async (tx) => {
    // Keep Korea's lock identity compatible with the previous deployment.
    await tx`select pg_advisory_xact_lock(hashtextextended(${"youtube-collector:" + (regionCode === "KR" ? lane : "JP")},0))`;
    await tx`update shorts_mvp.youtube_collection_runs
      set status=case when page_count>0 then 'partial' else 'failed' end,finished_at=clock_timestamp(),failed_pages=failed_pages+1
      where (lane=${lane} or ${regionCode}='JP') and region_code=${regionCode} and status='running' and started_at<clock_timestamp()-interval '10 minutes'`;
    const [busy] =
      await tx`select 1 from shorts_mvp.youtube_collection_runs where (lane=${lane} or ${regionCode}='JP') and region_code=${regionCode} and status='running'`;
    if (busy) return null;
    const [run] =
      await tx`insert into shorts_mvp.youtube_collection_runs(lane,scheduled_at,legacy,region_code)
      values(${lane},${scheduledAt},${legacy},${regionCode}) on conflict(lane,region_code,scheduled_at) do nothing returning id`;
    return run ? String(run.id) : null;
  });
}

async function persistPage(
  db: Sql,
  runId: string,
  lane: DiscoveryLane,
  items: CatalogVideo[],
  next?: {
    key: string;
    conditions: Record<string, string | null>;
    token?: string;
  },
  unavailableIds: string[] = [],
) {
  const observedAt = new Date();
  await db.begin(async (tx) => {
    await markCatalogUnavailable(tx, unavailableIds, observedAt);
    await saveCatalogPage(tx, items, {
      runId,
      trending: lane === "trending",
      observedAt,
    });
    if (items.length)
      await tx`insert into shorts_mvp.youtube_trending_run_items(run_id,catalog_id)
      select ${runId}::uuid,unnest(${items.map((item) => catalogId(item.videoId))}::text[]) on conflict do nothing`;
    if (next)
      await tx`insert into shorts_mvp.youtube_search_positions(source_key,conditions,page_token)
      values(${next.key},${tx.json(next.conditions)},${next.token || null})
      on conflict(source_key) do update set conditions=excluded.conditions,page_token=excluded.page_token,updated_at=clock_timestamp()`;
    await tx`update shorts_mvp.youtube_collection_runs set page_count=page_count+1,item_count=item_count+${items.length} where id=${runId}`;
  });
}

// During rollout the old read path remains usable. These short-lived compatibility
// snapshots are rebuilt only from a successful run and never replace the canonical history.
async function publishCompatibilitySnapshot(
  tx: TransactionSql,
  runId: string,
  lane: DiscoveryLane,
) {
  const prefix =
    lane === "trending"
      ? "popular_video"
      : lane === "free"
        ? "free_video"
        : "popular_search";
  const runTable = tx(`shorts_mvp.${prefix}_runs`);
  const itemTable = tx(`shorts_mvp.${prefix}_items`);
  const [run] =
    await tx`select * from shorts_mvp.youtube_collection_runs where id=${runId}`;
  if (lane === "trending") {
    await tx`insert into ${runTable}(id,snapshot_date,status,started_at,completed_at,page_count,item_count,completed_categories)
      values(${runId},${kstDate(new Date(run.startedAt))},'ready',${run.startedAt},${run.finishedAt},${run.pageCount},${run.itemCount},7) on conflict do nothing`;
  } else {
    await tx`insert into ${runTable}(id,snapshot_date,status,started_at,completed_at,page_count,item_count)
      values(${runId},${kstDate(new Date(run.startedAt))},'ready',${run.startedAt},${run.finishedAt},${run.pageCount},${run.itemCount}) on conflict do nothing`;
  }
  const rankColumn = tx(lane === "trending" ? "category_rank" : "search_rank");
  await tx`insert into ${itemTable}(run_id,video_id,category,${rankColumn},page_number,title,channel_name,thumbnail_url,
    duration_seconds,view_count,published_at,license,is_korean,collected_at)
    select ${runId}::uuid,c.video_id,c.metadata->>'category',row_number() over(order by (c.metadata->>'viewCount')::bigint desc),1,
      c.metadata->>'title',c.metadata->>'channelName',c.metadata->>'thumbnailUrl',(c.metadata->>'durationSeconds')::int,
      (c.metadata->>'viewCount')::bigint,(c.metadata->>'publishedAt')::timestamptz,c.metadata->>'license',
      (c.metadata->>'isKorean')::boolean,case when ${lane}='trending' then c.last_trending_at else c.verified_at end
    from shorts_mvp.youtube_trending_run_items i join shorts_mvp.youtube_catalog c on c.id=i.catalog_id
    where i.run_id=${runId} and c.metadata is not null and c.availability='public' on conflict do nothing`;
}

export async function collectDiscoveryLane(
  lane: DiscoveryLane,
  options: {
    db?: Sql;
    fetchImpl?: typeof fetch;
    scheduledAt?: Date;
    legacy?: boolean;
    maxDurationMs?: number;
  } = {},
) {
  const db = options.db || getDb();
  const fetchImpl = options.fetchImpl || fetch;
  const scheduledAt = options.scheduledAt || discoverySlot(lane);
  // Daily cadence still creates a new run. Only backfilled old runs are legacy.
  const runId = await claimRun(db, lane, scheduledAt, false);
  if (!runId) return { skipped: true, lane };
  const deadline = Date.now() + (options.maxDurationMs ?? 230_000);
  let failed = 0;
  let budgetExhausted = false;
  const failure = async (error?: unknown) => {
    if (error instanceof YoutubeQuotaError) budgetExhausted = true;
    failed++;
    await db`update shorts_mvp.youtube_collection_runs set failed_pages=failed_pages+1 where id=${runId}`;
  };
  await withYoutubePurpose(lane, db, async () => {
    if (lane === "trending") {
      for (const category of popularVideoSourceCategories) {
        if (budgetExhausted) break;
        let token: string | undefined;
        const seen = new Set<string>();
        let rank = 0;
        for (let page = 1; page <= POPULAR_VIDEO_CATEGORY_PAGE_LIMIT; page++) {
          if (Date.now() > deadline) {
            await failure();
            break;
          }
          try {
            const response = await requestPopularPage(
              category,
              token,
              fetchImpl,
            );
            const items = normalizePage(response, category.value, page, rank);
            await persistPage(db, runId, lane, items);
            rank += response.items.length;
            token = response.nextPageToken;
            if (!token) break;
            if (seen.has(token)) {
              await failure();
              break;
            }
            seen.add(token);
            if (page === POPULAR_VIDEO_CATEGORY_PAGE_LIMIT) await failure();
          } catch (error) {
            await failure(error);
            break;
          }
        }
      }
    } else {
      for (const task of discoverySearchTasks(
        lane,
        scheduledAt,
        options.legacy,
      )) {
        if (budgetExhausted) break;
        if (Date.now() > deadline) {
          await failure();
          break;
        }
        try {
          const conditions = {
            query: task.source.query || null,
            videoCategoryId: task.source.videoCategoryId || null,
            publishedAfter: task.source.publishedAfter?.toISOString() || null,
            videoLicense: lane === "reusable" ? "creativeCommon" : null,
          };
          const [position] = task.continuation
            ? await db`select page_token,conditions from shorts_mvp.youtube_search_positions where source_key=${task.key}`
            : [];
          const sameConditions =
            position &&
            Object.keys(conditions).every(
              (key) =>
                position.conditions[key] ===
                conditions[key as keyof typeof conditions],
            );
          const token = sameConditions
            ? position.pageToken || undefined
            : undefined;
          const search = await requestFreeSearchPage({
            source: task.source,
            videoLicense: lane === "reusable" ? "creativeCommon" : undefined,
            pageToken: token,
            fetchImpl,
          });
          const ids = [...new Set(search.items.map((item) => item.id.videoId))];
          const details = await requestVideoDetails(ids, fetchImpl);
          const verified = verifiedCatalogDetails(ids, details);
          await persistPage(
            db,
            runId,
            lane,
            verified.items,
            task.continuation
              ? {
                  key: task.key,
                  conditions,
                  token:
                    search.nextPageToken === token
                      ? undefined
                      : search.nextPageToken,
                }
              : undefined,
            verified.unavailableIds,
          );
        } catch (error) {
          // Invalidate once and wait for the NEXT scheduled run; no token retry loop.
          if (error instanceof InvalidSearchPageTokenError)
            await db`update shorts_mvp.youtube_search_positions set page_token=null,updated_at=clock_timestamp() where source_key=${task.key}`;
          await failure(error);
        }
      }
    }
  });
  await db.begin(async (tx) => {
    await tx`update shorts_mvp.youtube_collection_runs set finished_at=clock_timestamp(),
      item_count=(select count(*) from shorts_mvp.youtube_trending_run_items where run_id=${runId}),
      status=case when ${failed}=0 then 'success' when page_count>0 then 'partial' else 'failed' end where id=${runId}`;
    if (!failed) await publishCompatibilitySnapshot(tx, runId, lane);
    await tx
      .savepoint(async (counterDb) =>
        refreshCatalogViewCounter(counterDb, new Date()),
      )
      .catch(() => {
        console.error("youtube_catalog_counter_refresh_failed");
      });
  });
  return { runId, lane, failed, skipped: false };
}

export async function refreshCatalogBatch(
  options: {
    db?: Sql;
    fetchImpl?: typeof fetch;
    maxPages?: number;
    scheduledAt?: Date;
  } = {},
) {
  const db = options.db || getDb();
  const scheduledAt = options.scheduledAt || discoverySlot("refresh");
  const runId = await claimRun(db, "refresh", scheduledAt, false);
  if (!runId) return { skipped: true };
  let pages = 0;
  let failed = false;
  // Leave time for finishing the run and the route's cleanup within 300s.
  const deadline = Date.now() + 180_000;
  await withYoutubePurpose("refresh", db, async () => {
    for (let page = 0; page < Math.min(options.maxPages || 8, 25) && Date.now() < deadline; page++) {
      const batch = await db.begin(async (tx) => {
        const rows =
          await tx`select id,video_id,first_discovered_at::text as first_discovered_at from shorts_mvp.youtube_catalog c
          where video_id is not null and refresh_after<=clock_timestamp()
            and (exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and r.region_code='KR')
              or not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id))
            and (refresh_lease_until is null or refresh_lease_until<clock_timestamp())
          order by (verified_at<clock_timestamp()-interval '25 days') desc,
            (last_used_at>clock_timestamp()-interval '1 day') desc nulls last,
            (coalesce((metadata->>'viewCount')::bigint,0)>=1000000) desc,verified_at,id
          for update skip locked limit 50`;
        if (rows.length)
          await tx`update shorts_mvp.youtube_catalog set refresh_lease_until=clock_timestamp()+interval '5 minutes' where id in ${tx(rows.map((r) => r.id))}`;
        return rows;
      });
      if (!batch.length) break;
      try {
        const ids = batch.map((row) => String(row.videoId));
        // No maxResults parameter with an ID batch. A malformed/failed response never deletes anything.
        const details = await requestVideoDetails(
          ids,
          options.fetchImpl || fetch,
        );
        const verified = verifiedCatalogDetails(ids, details, true);
        const byId = new Map(
          verified.items.map((item) => [item.videoId, item]),
        );
        const now = new Date();
        await db.begin(async (tx) => {
          await saveCatalogPage(tx, verified.items, {
            observedAt: now,
            firstDiscoveredAtByVideoId: new Map(batch.map((row) => [
              String(row.videoId), String(row.firstDiscoveredAt),
            ])),
          });
          for (const row of batch) {
            if (byId.has(String(row.videoId))) continue;
            if (verified.pendingIds.includes(String(row.videoId)))
              await markCatalogMetadataPending(tx, [String(row.videoId)], String(row.firstDiscoveredAt), now);
            else await markCatalogUnavailable(tx, [String(row.videoId)], now);
          }
          await tx`update shorts_mvp.youtube_collection_runs set page_count=page_count+1,item_count=item_count+${batch.length} where id=${runId}`;
          await refreshCatalogViewCounter(tx, now);
        });
        pages++;
      } catch {
        failed = true;
        await db`update shorts_mvp.youtube_catalog set refresh_lease_until=null,refresh_after=clock_timestamp()+interval '1 hour' where id in ${db(batch.map((r) => r.id))}`;
        break;
      }
    }
  });
  await db`update shorts_mvp.youtube_collection_runs set finished_at=clock_timestamp(),failed_pages=${Number(failed)},
    status=${failed ? (pages ? "partial" : "failed") : "success"} where id=${runId}`;
  return { runId, pages, failed };
}
