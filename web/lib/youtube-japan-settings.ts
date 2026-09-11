import { HttpError } from "@/lib/http";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { japaneseCollectionEnabled, japaneseDiscoveryEnabled, japaneseQuotaVerified } from "@/lib/youtube-quota";

export async function getJapanSettings(db: Sql | TransactionSql = getDb()) {
  const [row] = await db`select japan_collection_enabled,japan_discovery_enabled,
    japan_verified_at,japan_activated_at from shorts_mvp.youtube_quota_verifications
    where project_id=${process.env.YOUTUBE_QUOTA_PROJECT_ID || ""}`;
  return {
    collection: japaneseCollectionEnabled() && Boolean(row?.japan_collection_enabled ?? row?.japanCollectionEnabled),
    reads: japaneseDiscoveryEnabled() && Boolean(row?.japan_discovery_enabled ?? row?.japanDiscoveryEnabled),
    configuredCollection: Boolean(row?.japanCollectionEnabled ?? row?.japan_collection_enabled),
    configuredReads: Boolean(row?.japanDiscoveryEnabled ?? row?.japan_discovery_enabled),
    activated: Boolean(row?.japanActivatedAt ?? row?.japan_activated_at),
    verifiedAt: row?.japanVerifiedAt ?? row?.japan_verified_at ?? null,
  };
}

/** No process cache: the next request must observe an operator's OFF switch. */
export async function japanReadsEnabled(db: Sql | TransactionSql = getDb()) {
  if (!japaneseDiscoveryEnabled()) return false;
  return (await getJapanSettings(db)).reads;
}

export async function updateJapanSettings(db: Sql, actorId: string, input: { collection: boolean; reads: boolean }) {
  const project = process.env.YOUTUBE_QUOTA_PROJECT_ID || "";
  await db.begin(async tx => {
    const [row] = await tx`select project_id from shorts_mvp.youtube_quota_verifications where project_id=${project} for update`;
    if (!row) throw new HttpError(409, "YouTube 프로젝트 확인 기록이 없습니다.");
    const settings = await getJapanSettings(tx);
    if ((input.collection || input.reads) && !settings.activated) throw new HttpError(409, "일본 기능 DB 전환을 먼저 완료해 주세요.");
    if (input.collection) {
      const verified = await japaneseQuotaVerified(tx);
      if (!japaneseCollectionEnabled() || !verified || !verified.searchEnabled)
        throw new HttpError(409, "현재 프로젝트의 일본 수집 한도 확인이 필요합니다.");
    }
    if (input.reads && !settings.configuredReads) {
      const [ready] = await tx`select count(distinct lane)::int as lanes from shorts_mvp.youtube_collection_runs
        where region_code='JP' and lane in ('trending','views','reusable') and status='success'
          and scheduled_at<=clock_timestamp() and finished_at>clock_timestamp()-interval '30 days'`;
      if (!japaneseDiscoveryEnabled() || Number(ready?.lanes) !== 3) throw new HttpError(409, "세 종류의 첫 정상 수집을 확인한 뒤 노출할 수 있습니다.");
    }
    await tx`update shorts_mvp.youtube_quota_verifications set japan_collection_enabled=${input.collection},
      japan_discovery_enabled=${input.reads} where project_id=${project}`;
    await tx`insert into shorts_mvp.youtube_japan_settings_audit(project_id,actor_id,collection_enabled,discovery_enabled)
      values(${project},${actorId},${input.collection},${input.reads})`;
  });
}
