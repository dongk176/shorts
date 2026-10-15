import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { discoveryEnabled, catalogReadsEnabled } from "@/lib/youtube-quota";

export const englishCollectionEnabled = () => discoveryEnabled()
  && process.env.YOUTUBE_EN_COLLECTION_ENABLED === "true";

export async function englishReadsEnabled(db: Sql | TransactionSql = getDb()) {
  if (!catalogReadsEnabled() || process.env.YOUTUBE_EN_DISCOVERY_ENABLED !== "true") return false;
  const [row] = await db`select english_discovery_enabled from shorts_mvp.youtube_quota_verifications
    where project_id=${process.env.YOUTUBE_QUOTA_PROJECT_ID || ""}`;
  return Boolean(row?.englishDiscoveryEnabled ?? row?.english_discovery_enabled);
}

export async function englishQuotaVerified(db: Sql | TransactionSql = getDb()) {
  const project = process.env.YOUTUBE_QUOTA_PROJECT_ID;
  const key = process.env.YOUTUBE_API_KEY;
  if (!englishCollectionEnabled() || !project || !key) return false;
  const [row] = await db`select 1 from shorts_mvp.youtube_quota_verifications
    where project_id=${project} and key_fingerprint=${createHash("sha256").update(key).digest("hex")}
      and english_collection_enabled and general_daily_limit>=10000 and other_clients_reviewed
      and accounting_ready_from<=(clock_timestamp() at time zone 'America/Los_Angeles')::date`;
  return Boolean(row);
}
