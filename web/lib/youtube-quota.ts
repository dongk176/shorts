import { HttpError } from "@/lib/http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { getDb } from "@/lib/db";

export type YoutubePurpose =
  | "analysis"
  | "trending"
  | "views"
  | "reusable"
  | "free"
  | "refresh";
const context = new AsyncLocalStorage<{ purpose: YoutubePurpose; db: Sql }>();
export const discoveryEnabled = () =>
  process.env.YOUTUBE_DISCOVERY_ENABLED === "true";
export const catalogReadsEnabled = () =>
  discoveryEnabled() && process.env.YOUTUBE_CATALOG_READS_ENABLED === "true";
export class YoutubeQuotaError extends HttpError {
  constructor() {
    super(
      429,
      "YouTube 확인 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
      "YOUTUBE_QUOTA_EXHAUSTED",
      60,
    );
    this.name = "YoutubeQuotaError";
  }
}
export function withYoutubePurpose<T>(
  purpose: YoutubePurpose,
  db: Sql,
  work: () => Promise<T>,
) {
  return context.run({ purpose, db }, work);
}
export async function youtubeRequest(
  purpose: YoutubePurpose,
  endpoint: URL,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
) {
  if (discoveryEnabled()) {
    const project = process.env.YOUTUBE_QUOTA_PROJECT_ID;
    if (!project) throw new YoutubeQuotaError();
    const current = context.getStore();
    const db = current?.db || getDb();
    const bucket = endpoint.pathname.endsWith("/search") ? "search" : "general";
    const rows =
      await db`select shorts_mvp.reserve_youtube_quota(${project},${bucket},${current?.purpose || purpose},1) as id`;
    if (!rows[0]?.id) throw new YoutubeQuotaError();
  }
  return fetchImpl(endpoint, init);
}

export async function expandedDiscoveryEnabled(db: Sql = getDb()) {
  if (!discoveryEnabled() || process.env.YOUTUBE_DISCOVERY_EXPANDED !== "true")
    return false;
  const project = process.env.YOUTUBE_QUOTA_PROJECT_ID;
  const key = process.env.YOUTUBE_API_KEY;
  if (!project || !key) return false;
  const fingerprint = createHash("sha256").update(key).digest("hex");
  const rows = await db`select 1 from shorts_mvp.youtube_quota_verifications
    where project_id=${project} and key_fingerprint=${fingerprint}
      and search_daily_limit>=100 and general_daily_limit>=10000
      and other_clients_reviewed and backfill_verified_at is not null and expanded_at is not null
      and accounting_ready_from <= (clock_timestamp() at time zone 'America/Los_Angeles')::date`;
  return Boolean(rows[0]);
}

export function youtubeRequestContextDb() {
  return context.getStore()?.db || getDb();
}
