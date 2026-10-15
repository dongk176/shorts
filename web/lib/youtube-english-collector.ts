import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import { saveCatalogPage, type CatalogVideo } from "@/lib/youtube-catalog";
import { claimRun } from "@/lib/youtube-discovery-collector";
import { normalizePage, popularVideoSourceCategories, requestPopularPage } from "@/lib/youtube-popular";
import { englishCollectionEnabled, englishQuotaVerified } from "@/lib/youtube-english-settings";
import { withYoutubePurpose, YoutubeQuotaError } from "@/lib/youtube-quota";

export const englishRegions = ["US", "GB"] as const;
export function englishCollectionSlot(now = new Date()) {
  const slot = new Date(now);
  slot.setUTCHours(Math.floor(slot.getUTCHours() / 4) * 4, 25, 0, 0);
  if (slot > now) slot.setUTCHours(slot.getUTCHours() - 4);
  return slot;
}

/** At most 2 regions × 7 categories × 2 pages per slot, with no search.list calls. */
export async function collectEnglishVideos(options: {
  db?: Sql; fetchImpl?: typeof fetch; scheduledAt?: Date; maxDurationMs?: number;
} = {}) {
  if (!englishCollectionEnabled()) return { skipped: true, reason: "disabled" };
  const db = options.db || getDb();
  if (!await englishQuotaVerified(db)) return { skipped: true, reason: "english_quota_unverified" };
  const scheduledAt = options.scheduledAt || englishCollectionSlot();
  if (scheduledAt > new Date() || scheduledAt.getTime() !== englishCollectionSlot().getTime())
    return { skipped: true, reason: "invalid_slot" };
  const deadline = Date.now() + Math.min(240_000, Math.max(0, options.maxDurationMs ?? 240_000));
  const results: Array<{ region: "US" | "GB"; skipped?: boolean; failed?: boolean; items?: number; pages?: number }> = [];
  for (const region of englishRegions) {
    if (Date.now() >= deadline) break;
    const runId = await claimRun(db, "trending", scheduledAt, false, region);
    if (!runId) { results.push({ region, skipped: true }); continue; }
    const items: CatalogVideo[] = [];
    let pages = 0;
    try {
      await withYoutubePurpose("trending", db, async () => {
        for (const category of popularVideoSourceCategories) {
          let token: string | undefined;
          const seen = new Set<string>();
          for (let page = 1; page <= 2; page++) {
            const response = await requestPopularPage(category, token, options.fetchImpl || fetch, region);
            pages++;
            items.push(...normalizePage(response, category.value, page, (page - 1) * 50));
            token = response.nextPageToken;
            if (!token || seen.has(token)) break;
            seen.add(token);
          }
        }
      }, { region, deadline });
      if (Date.now() >= deadline || !await englishQuotaVerified(db)) throw new YoutubeQuotaError();
      const observedAt = new Date();
      const count = new Set(items.map(item => item.videoId)).size;
      await db.begin(async tx => {
        await saveCatalogPage(tx, items, { runId, regionCode: region, trending: true, observedAt });
        await tx`update shorts_mvp.youtube_collection_runs set status='success',finished_at=${observedAt},
          page_count=${pages},item_count=${count} where id=${runId}`;
      });
      results.push({ region, items: count, pages });
    } catch (error) {
      await db`update shorts_mvp.youtube_collection_runs set status='failed',finished_at=clock_timestamp(),
        page_count=${pages},failed_pages=1 where id=${runId}`;
      results.push({ region, failed: true });
      console.error("youtube_english_collection_failed", { region, errorName: error instanceof Error ? error.name : "UnknownError" });
      // Quota or deadline failures stop this batch; never switch keys or projects.
      if (error instanceof YoutubeQuotaError) break;
    }
  }
  return { skipped: false, results, failed: results.some(result => result.failed), timedOut: Date.now() >= deadline };
}
