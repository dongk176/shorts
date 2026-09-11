import { HttpError } from "@/lib/http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";

export type YoutubePurpose =
  | "analysis"
  | "trending"
  | "views"
  | "reusable"
  | "free"
  | "refresh";
export type YoutubeRegion = "KR" | "JP";
type RequestContext = { purpose: YoutubePurpose; db: Sql; region?: YoutubeRegion; deadline?: number; stopped?: boolean };
const context = new AsyncLocalStorage<RequestContext>();
export const discoveryEnabled = () =>
  process.env.YOUTUBE_DISCOVERY_ENABLED === "true";
export const catalogReadsEnabled = () =>
  discoveryEnabled() && process.env.YOUTUBE_CATALOG_READS_ENABLED === "true";
export const japaneseDiscoveryEnabled = () =>
  catalogReadsEnabled() && process.env.YOUTUBE_JP_DISCOVERY_ENABLED === "true";
export const japaneseCollectionEnabled = () =>
  discoveryEnabled() && process.env.YOUTUBE_JP_COLLECTION_ENABLED === "true";
export async function japaneseQuotaVerified(db: Sql | TransactionSql = getDb()) {
  const project = process.env.YOUTUBE_QUOTA_PROJECT_ID;
  const key = process.env.YOUTUBE_API_KEY;
  if (!project || !key) return false;
  const fingerprint = createHash("sha256").update(key).digest("hex");
  const rows = await db`select japan_search_daily_ceiling from shorts_mvp.youtube_quota_verifications
    where project_id=${project} and key_fingerprint=${fingerprint}
      and search_daily_limit>=100 and general_daily_limit>=10000 and other_clients_reviewed
      and japan_activated_at is not null
      and japan_verified_at>clock_timestamp()-interval '7 days' and length(japan_evidence)>0
      and accounting_ready_from<=(clock_timestamp() at time zone 'America/Los_Angeles')::date`;
  return rows[0] ? { searchEnabled: Number(rows[0].japanSearchDailyCeiling) >= 100 } : null;
}
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
  options: { region?: YoutubeRegion; deadline?: number } = {},
) {
  return context.run({ purpose, db, ...options }, work);
}
export async function youtubeRequest(
  purpose: YoutubePurpose,
  endpoint: URL,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
) {
  const current = context.getStore();
  const effectivePurpose = current?.purpose || purpose;
  const background = effectivePurpose !== "analysis";
  if (current?.stopped || (current?.deadline !== undefined && Date.now() >= current.deadline)) throw new YoutubeQuotaError();
  // All background entry points count attempts, including the legacy collectors.
  if (discoveryEnabled() || background) {
    const project = process.env.YOUTUBE_QUOTA_PROJECT_ID;
    if (!project) throw new YoutubeQuotaError();
    const db = current?.db || getDb();
    const bucket = endpoint.pathname.endsWith("/search") ? "search" : "general";
    try {
      const rows = current?.region === "JP"
        ? await db`select shorts_mvp.reserve_youtube_japan_quota(${project},${bucket},${effectivePurpose},1) as id`
        : await db`select shorts_mvp.reserve_youtube_quota(${project},${bucket},${effectivePurpose},1) as id`;
      if (!rows[0]?.id) throw new YoutubeQuotaError();
    } catch (error) {
      if (!background) throw error;
      if (current) current.stopped = true;
      throw new YoutubeQuotaError();
    }
  }
  if (current?.deadline !== undefined && Date.now() >= current.deadline) {
    current.stopped = true;
    throw new YoutubeQuotaError();
  }
  const timeout = current?.deadline === undefined ? 15_000 : Math.max(1, Math.min(15_000, current.deadline - Date.now()));
  const signal = background
    ? (init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout))
    : init.signal;
  const response = await fetchImpl(endpoint, { ...init, signal });
  if (background && !response.ok) {
    const body = await response.clone().json().catch(() => null);
    if (response.status === 429 || body?.error?.errors?.some((error: { reason?: string }) =>
      ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(error.reason || ""))) {
      if (current) current.stopped = true;
      throw new YoutubeQuotaError();
    }
  }
  return response;
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
