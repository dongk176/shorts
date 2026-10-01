import "server-only";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";

export const RECENT_UPDATES_TAG = "public-recent-updates";
let pending: Promise<number[]> | null = null;

export const recentUpdateDates = unstable_cache(async (): Promise<number[]> => {
  if (!pending) {
    pending = (async () => {
      const rows = await getDb()`select distinct published->>'date' as date from shorts_mvp.update_posts where visible=true and published is not null and (published->>'date')::date >= (now() at time zone 'Asia/Seoul')::date - 7`;
      return rows.map(row => Date.parse(`${row.date}T00:00:00+09:00`));
    })().finally(() => { pending = null; });
  }
  return pending;
}, ["public-recent-updates-v1"], { revalidate: 60, tags: [RECENT_UPDATES_TAG] });
