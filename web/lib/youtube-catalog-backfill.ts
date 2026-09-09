import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import {
  catalogId,
  saveCatalogPage,
  type CatalogVideo,
} from "@/lib/youtube-catalog";
import { DAY_MS, kstDate } from "@/lib/youtube-discovery-time";
import {
  verifiedCatalogDetails,
  requestVideoDetails,
} from "@/lib/youtube-free";
import { withYoutubePurpose } from "@/lib/youtube-quota";

const sources = [
  { prefix: "popular_video", lane: "trending" },
  { prefix: "popular_search", lane: "views" },
  { prefix: "free_video", lane: "free" },
] as const;
/** Bounded/resumable: one source run, at most 500 rows, before advancing its checkpoint. */
export async function backfillCatalogBatch(
  db: Sql = getDb(),
  fetchImpl: typeof fetch = fetch,
) {
  return withYoutubePurpose("refresh", db, async () => {
    for (const source of sources) {
      const [run] =
        await db`select r.*,coalesce(i.next_offset,0)::int as next_offset
        from ${db(`shorts_mvp.${source.prefix}_runs`)} r
        left join shorts_mvp.youtube_catalog_imports i on i.source=${source.prefix} and i.legacy_run_id=r.id
        where r.status in ('ready','failed') and i.completed_at is null
          and not exists(select 1 from shorts_mvp.youtube_collection_runs n where n.id=r.id and n.legacy=false)
        order by r.started_at,r.id limit 1`;
      if (!run) continue;
      const [newRun] =
        await db`insert into shorts_mvp.youtube_collection_runs(id,lane,scheduled_at,started_at,finished_at,status,page_count,item_count,legacy)
        values(${run.id},${source.lane},${run.startedAt},${run.startedAt},${run.completedAt || run.startedAt},
          ${run.status === "ready" ? "success" : "failed"},${run.pageCount},${run.itemCount},true)
        on conflict(lane,scheduled_at) do update set legacy=youtube_collection_runs.legacy returning id`;
      await db`insert into shorts_mvp.youtube_catalog_imports(source,legacy_run_id) values(${source.prefix},${run.id}) on conflict do nothing`;
      const rows =
        run.status === "ready"
          ? await db`select distinct on(video_id) video_id,category,title,channel_name,thumbnail_url,duration_seconds,
          view_count,published_at,license,is_korean,collected_at from ${db(`shorts_mvp.${source.prefix}_items`)}
          where run_id=${run.id} order by video_id,collected_at desc offset ${run.nextOffset} limit 500`
          : [];
      let processed = 0;
      for (let offset = 0; offset < rows.length; offset += 50) {
        const batch = rows.slice(offset, offset + 50);
        const ids = batch.map((row) => String(row.videoId));
        const current =
          await db`select id,metadata,verified_at from shorts_mvp.youtube_catalog where id in ${db(ids.map(catalogId))}`;
        const existing = new Map(current.map((row) => [String(row.id), row]));
        const stale = ids.filter(
          (id, index) =>
            new Date(batch[index].collectedAt).getTime() <=
              Date.now() - 30 * DAY_MS &&
            (!existing.get(catalogId(id)) ||
              new Date(existing.get(catalogId(id))!.verifiedAt).getTime() <=
                Date.now() - 30 * DAY_MS),
        );
        const fresh = stale.length
          ? verifiedCatalogDetails(
              stale,
              await requestVideoDetails(stale, fetchImpl),
            ).items
          : [];
        const freshById = new Map(fresh.map((item) => [item.videoId, item]));
        const now = new Date();
        await db.begin(async (tx) => {
          for (const row of batch) {
            const id = String(row.videoId);
            const internalId = catalogId(id);
            const known = existing.get(internalId);
            const observedAt = new Date(row.collectedAt);
            const item =
              known && new Date(known.verifiedAt) > observedAt
                ? (known.metadata as CatalogVideo | null)
                : stale.includes(id)
                  ? freshById.get(id)
                  : ({
                      videoId: id,
                      category: row.category,
                      title: row.title,
                      channelName: row.channelName,
                      thumbnailUrl: row.thumbnailUrl,
                      durationSeconds: Number(row.durationSeconds),
                      viewCount: Number(row.viewCount),
                      publishedAt: new Date(row.publishedAt).toISOString(),
                      license: row.license,
                      isKorean: row.isKorean,
                    } as CatalogVideo);
            const verifiedAt =
              known && new Date(known.verifiedAt) > observedAt
                ? new Date(known.verifiedAt)
                : stale.includes(id)
                  ? now
                  : observedAt;
            if (item)
              await saveCatalogPage(tx, [item], {
                runId: String(newRun.id),
                trending: source.lane === "trending",
                observedAt,
                verifiedAt,
              });
            else {
              await tx`insert into shorts_mvp.youtube_catalog(id,first_discovered_at,verified_at,availability)
                values(${internalId},${observedAt},${verifiedAt},'unavailable')
                on conflict(id) do update set first_discovered_at=least(youtube_catalog.first_discovered_at,excluded.first_discovered_at)`;
              if (source.lane === "trending")
                await tx`insert into shorts_mvp.youtube_trending_days(day,catalog_id,first_seen_at,last_seen_at)
                values(${kstDate(observedAt)},${internalId},${observedAt},${observedAt}) on conflict(day,catalog_id) do update set
                  first_seen_at=least(youtube_trending_days.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(youtube_trending_days.last_seen_at,excluded.last_seen_at)`;
            }
          }
          await tx`update shorts_mvp.youtube_catalog_imports set next_offset=greatest(next_offset,${Number(run.nextOffset) + offset + batch.length})
            where source=${source.prefix} and legacy_run_id=${run.id}`;
        });
        processed += batch.length;
      }
      if (rows.length < 500)
        await db`update shorts_mvp.youtube_catalog_imports set completed_at=clock_timestamp()
        where source=${source.prefix} and legacy_run_id=${run.id}`;
      return {
        done: false,
        source: source.prefix,
        runId: String(run.id),
        processed,
      };
    }
    return { done: true };
  });
}

/** Legacy cleanup is a separate rollout action, never a consequence of enabling
 * the catalog or recording a completed backfill. Keep it off through promotion
 * and restore verification. Temporary new compatibility snapshots keep their TTL. */
export async function cleanupImportedSnapshots(db: Sql = getDb()) {
  const cleanupLegacy =
    process.env.YOUTUBE_LEGACY_SNAPSHOT_CLEANUP_ENABLED === "true" &&
    (await getCatalogBackfillReadiness(db)).ready;
  for (const source of sources) {
    if (cleanupLegacy)
      await db`delete from ${db(`shorts_mvp.${source.prefix}_items`)} where run_id in (
      select r.id from ${db(`shorts_mvp.${source.prefix}_runs`)} r
      join shorts_mvp.youtube_catalog_imports i on i.legacy_run_id=r.id and i.source=${source.prefix}
      where r.status='ready' and i.completed_at is not null and r.completed_at<clock_timestamp()-${source.prefix === "free_video" ? "3 days" : "48 hours"}::interval
        and exists(select 1 from shorts_mvp.youtube_quota_verifications where project_id=${process.env.YOUTUBE_QUOTA_PROJECT_ID || ""} and backfill_verified_at is not null))`;
    await db`delete from ${db(`shorts_mvp.${source.prefix}_runs`)} where id in (
      select id from shorts_mvp.youtube_collection_runs where legacy=false and finished_at<clock_timestamp()-${source.prefix === "free_video" ? "3 days" : "48 hours"}::interval)`;
  }
}

/** Read-only comparison. Keep old snapshots until these counts are all zero. */
export async function getCatalogBackfillReadiness(db: Sql = getDb()) {
  let pendingRuns = 0;
  let missingVideos = 0;
  let incorrectFirstDiscovery = 0;
  for (const source of sources) {
    const [pending] = await db`select count(*)::int as count
      from ${db(`shorts_mvp.${source.prefix}_runs`)} r
      where r.status in ('ready','failed')
        and not exists(select 1 from shorts_mvp.youtube_catalog_imports i where i.source=${source.prefix} and i.legacy_run_id=r.id and i.completed_at is not null)
        and not exists(select 1 from shorts_mvp.youtube_collection_runs n where n.id=r.id and n.legacy=false)`;
    const [comparison] =
      await db`select count(*) filter(where c.id is null)::int as missing,
      count(*) filter(where c.first_discovered_at>i.collected_at)::int as incorrect
      from ${db(`shorts_mvp.${source.prefix}_items`)} i
      join ${db(`shorts_mvp.${source.prefix}_runs`)} r on r.id=i.run_id and r.status='ready'
      left join shorts_mvp.youtube_catalog c on c.id=encode(sha256(convert_to(i.video_id,'UTF8')),'hex')`;
    pendingRuns += Number(pending.count);
    missingVideos += Number(comparison.missing);
    incorrectFirstDiscovery += Number(comparison.incorrect);
  }
  const [days] =
    await db`select count(*)::int as missing from shorts_mvp.popular_video_items i
    join shorts_mvp.popular_video_runs r on r.id=i.run_id and r.status='ready'
    where not exists(select 1 from shorts_mvp.youtube_trending_days d
      where d.day=(i.collected_at at time zone 'Asia/Seoul')::date and d.catalog_id=encode(sha256(convert_to(i.video_id,'UTF8')),'hex'))`;
  const [catalog] = await db`select count(*)::int as total,
    count(*) filter(where metadata is not null and verified_at<=clock_timestamp()-interval '30 days')::int as expired
    from shorts_mvp.youtube_catalog`;
  const missingDays = Number(days.missing);
  const expiredMetadata = Number(catalog.expired);
  return {
    pendingRuns,
    missingVideos,
    incorrectFirstDiscovery,
    missingDays,
    expiredMetadata,
    ready:
      Number(catalog.total) > 0 &&
      pendingRuns +
        missingVideos +
        incorrectFirstDiscovery +
        missingDays +
        expiredMetadata ===
        0,
  };
}
