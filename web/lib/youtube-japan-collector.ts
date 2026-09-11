import { getJapanSettings } from "@/lib/youtube-japan-settings";
import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import { saveCatalogPage, markCatalogUnavailable, type CatalogVideo } from "@/lib/youtube-catalog";
import { claimRun } from "@/lib/youtube-discovery-collector";
import { DAY_MS, kstDate } from "@/lib/youtube-discovery-time";
import { requestFreeSearchPage, requestVideoDetails, verifiedCatalogDetails, type SearchVideoSource } from "@/lib/youtube-free";
import { normalizePage, popularVideoSourceCategories, requestPopularPage } from "@/lib/youtube-popular";
import { japaneseCollectionEnabled, japaneseQuotaVerified, withYoutubePurpose, YoutubeQuotaError } from "@/lib/youtube-quota";

type JapanLane = "trending" | "reusable" | "views";
export function japanSearchSources(lane: "views" | "reusable", scheduledAt: Date): SearchVideoSource[] {
  const categories = popularVideoSourceCategories;
  const day = Math.floor(Date.parse(`${kstDate(scheduledAt)}T00:00:00Z`) / DAY_MS);
  const chosen = lane === "reusable" ? [...categories]
    : Array.from({ length: 3 }, (_, i) => categories[(day * 3 + i) % categories.length]);
  return chosen.map(category => ({
    videoCategoryId: category.videoCategoryId, regionCode: "JP", relevanceLanguage: "ja",
    publishedAfter: lane === "reusable" ? null : new Date(scheduledAt.getTime() - 7 * DAY_MS),
  }));
}
export function japanCollectionSlot(now = new Date()) {
  const slot = new Date(now); slot.setUTCHours(8, 15, 0, 0);
  if (slot > now) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot;
}
export async function collectJapanVideos(options: {
  db?: Sql; fetchImpl?: typeof fetch; scheduledAt?: Date; maxDurationMs?: number;
} = {}) {
  if (!japaneseCollectionEnabled()) return { skipped: true, reason: "disabled" };
  const deadline = Date.now() + Math.min(240_000, Math.max(0, options.maxDurationMs ?? 240_000));
  const db = options.db || getDb();
  if (!(await getJapanSettings(db)).collection) return { skipped: true, reason: "disabled" };
  const verification = await japaneseQuotaVerified(db);
  if (!verification) return { skipped: true, reason: "japan_quota_unverified" };
  const fetchImpl = options.fetchImpl || fetch;
  const scheduledAt = options.scheduledAt || japanCollectionSlot();
  if (scheduledAt > new Date()) return { skipped: true, reason: "future_slot" };
  const project = process.env.YOUTUBE_QUOTA_PROJECT_ID || "";
  const claimed = await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended('youtube-japan-batch:' || ${project},0))`;
    const [existing] = await tx`select 1 from shorts_mvp.youtube_collection_runs
      where region_code='JP' and (scheduled_at=${scheduledAt} or status='running') limit 1`;
    if (existing) return false;
    const [batch] = await tx`insert into shorts_mvp.youtube_japan_batches(project_id,quota_day,scheduled_at)
      values(${project},(clock_timestamp() at time zone 'America/Los_Angeles')::date,${scheduledAt})
      on conflict do nothing returning project_id`;
    return Boolean(batch);
  });
  if (!claimed) return { skipped: true, reason: "already_collected" };
  const results: Array<{ lane: JapanLane; skipped?: boolean; failed?: boolean; items?: number }> = [];
  for (const lane of ["trending", "reusable", "views"] as const) {
    if (lane !== "trending" && !verification.searchEnabled) { results.push({ lane, skipped: true }); continue; }
    if (Date.now() >= deadline) break;
    const runId = await claimRun(db, lane, scheduledAt, false, "JP");
    if (!runId) { results.push({ lane, skipped: true }); continue; }
    const items: CatalogVideo[] = [];
    const unavailableIds: string[] = [];
    let pages = 0;
    try {
      await withYoutubePurpose(lane, db, async () => {
        if (lane === "trending") {
          for (const category of popularVideoSourceCategories) {
            const response = await requestPopularPage(category, undefined, fetchImpl, "JP");
            items.push(...normalizePage(response, category.value, 1, 0)); pages++;
          }
        } else {
          for (const source of japanSearchSources(lane, scheduledAt)) {
            const search = await requestFreeSearchPage({ source, fetchImpl,
              videoLicense: lane === "reusable" ? "creativeCommon" : undefined });
            const ids = [...new Set(search.items.map(item => item.id.videoId))];
            const verified = verifiedCatalogDetails(ids, await requestVideoDetails(ids, fetchImpl));
            items.push(...verified.items.filter(item => lane !== "reusable" || item.license === "creativeCommon"));
            unavailableIds.push(...verified.unavailableIds); pages++;
          }
        }
      }, { region: "JP", deadline });
      if (Date.now() >= deadline) throw new YoutubeQuotaError();
      if (!(await getJapanSettings(db)).collection) throw new YoutubeQuotaError();
      const now = new Date();
      await db.begin(async tx => {
        await markCatalogUnavailable(tx, unavailableIds, now);
        await saveCatalogPage(tx, items, { runId, regionCode: "JP", trending: lane === "trending", observedAt: now });
        await tx`update shorts_mvp.youtube_collection_runs set status='success',finished_at=${now},page_count=${pages},
          item_count=${new Set(items.map(item => item.videoId)).size} where id=${runId}`;
      });
      results.push({ lane, items: new Set(items.map(item => item.videoId)).size });
    } catch (error) {
      await db`update shorts_mvp.youtube_collection_runs set status='failed',finished_at=clock_timestamp(),failed_pages=1 where id=${runId}`.catch(() => undefined);
      results.push({ lane, failed: true });
      console.error("youtube_japan_collection_failed", { lane, errorName: error instanceof Error ? error.name : "UnknownError" });
      if (error instanceof YoutubeQuotaError) break;
    }
  }
  return { skipped: false, results, failed: results.some(result => result.failed), timedOut: Date.now() >= deadline };
}
