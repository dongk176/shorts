import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import {
  CREATOR_SUPPORT_PROGRAM, CREATOR_SUPPORT_TERMS_VERSION, creatorSupportTerms,
  maskCreatorEmail, maskCreatorName, normalizeCreatorChannel,
  type CreatorEnrollmentInput, type CreatorSupportMe, type CreatorSupportStatus,
} from "@/lib/creator-support";

export function creatorAccountKey(userId: string) {
  return createHash("sha256").update(`${CREATOR_SUPPORT_PROGRAM}:${userId}`).digest("hex");
}
export async function requireCreatorAccount() {
  const auth = await getAuthenticatedUser();
  if (!auth) throw new HttpError(401, "다시 로그인한 뒤 계속해 주세요.", "AUTH_REQUIRED");
  const [row] = await getDb()`
    select id,display_name,email,provider,created_at from shorts_mvp.app_users
    where auth_user_id=${auth.id} and withdrawn_at is null limit 1
  `;
  if (!row) throw new HttpError(401, "이지컷에 다시 로그인해 주세요.", "AUTH_REQUIRED");
  return {
    id: String(row.id), key: creatorAccountKey(String(row.id)),
    name: maskCreatorName(row.displayName), email: maskCreatorEmail(row.email),
    provider: row.provider === "kakao" ? "카카오" : row.provider === "google" ? "구글" : "이지컷",
    joinedAt: new Date(row.createdAt).toISOString(),
  };
}
export function assertCreatorAccount(key: string, account: { key: string }) {
  if (key !== account.key) throw new HttpError(409, "로그인 계정이 바뀌었어요. 계정 확인부터 다시 진행해 주세요.", "ACCOUNT_CHANGED");
}
export function creatorJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
export function creatorError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const codes: Record<string, [number, string]> = {
    CREATOR_ENROLLMENT_CLOSED: [409, "지금은 신규 모집을 준비 중이거나 마감했어요. 기존 지원 일정은 유지됩니다."],
    CREATOR_TERMS_CHANGED: [409, "참여 조건이 변경됐어요. 새로고침 후 동의를 다시 확인해 주세요."],
    CREATOR_CONSENT_REQUIRED: [400, "참여 동의를 모두 확인해 주세요."],
    CREATOR_ASSET_UNAVAILABLE: [400, "이미지를 다시 추가해 주세요."],
    CREATOR_ACCOUNT_UNAVAILABLE: [401, "이지컷에 다시 로그인해 주세요."],
  };
  const code = Object.keys(codes).find((key) => message.includes(key));
  if (code) error = new HttpError(codes[code][0], codes[code][1], code);
  if ((error as { code?: string })?.code === "23505") {
    error = new HttpError(409, "이미 신청된 채널입니다. 다른 운영 채널을 등록해 주세요.", "CHANNEL_ALREADY_ENROLLED");
  }
  const response = apiError(error, "신청 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
export async function creatorSchemaReady(db: Sql = getDb()) {
  const [row] = await db`select to_regclass('shorts_mvp.creator_support_programs') is not null as ready`;
  return row?.ready === true;
}
export async function creatorProgram(db: Sql = getDb()) {
  if (!await creatorSchemaReady(db)) return null;
  const [row] = await db`select * from shorts_mvp.creator_support_programs where code=${CREATOR_SUPPORT_PROGRAM}`;
  return row || null;
}
export async function getCreatorStatus(userId: string, db: Sql = getDb()): Promise<CreatorSupportStatus | null> {
  const [row] = await db`
    select *,clock_timestamp() as server_now from shorts_mvp.creator_support_enrollments
    where program_code=${CREATOR_SUPPORT_PROGRAM} and user_id=${userId}
  `;
  if (!row) return null;
  const grants = await db`
    select i.installment,g.valid_from,g.expires_at,g.total_seconds,g.consumed_seconds,g.reserved_seconds,g.status
    from shorts_mvp.creator_support_installments i join shorts_mvp.usage_grants g on g.id=i.grant_id
    where i.enrollment_id=${row.id} order by i.installment
  `;
  const now = new Date(row.serverNow).getTime();
  return {
    id: row.id, channelName: row.channelName, channelUrl: row.channelUrl, platform: row.platform,
    activatedAt: new Date(row.activatedAt).toISOString(), supportEndsAt: new Date(row.supportEndsAt).toISOString(),
    promotionEndsAt: new Date(row.promotionEndsAt).toISOString(),
    terminatedAt: row.terminatedAt ? new Date(row.terminatedAt).toISOString() : null,
    promotionStatus: row.terminatedAt ? "stopped" : new Date(row.promotionEndsAt).getTime() <= now ? "expired" : row.promotionStatus,
    installments: grants.map((g) => {
      const state = g.status === "revoked" ? "canceled" : new Date(g.expiresAt).getTime() <= now || g.status === "expired"
        ? "expired" : new Date(g.validFrom).getTime() > now ? "scheduled" : "available";
      return {
        number: g.installment, validFrom: new Date(g.validFrom).toISOString(), expiresAt: new Date(g.expiresAt).toISOString(),
        totalSeconds: g.totalSeconds,
        remainingSeconds: state === "available" ? Math.max(0, g.totalSeconds - g.consumedSeconds - g.reservedSeconds) : 0,
        state,
      };
    }),
  };
}
export async function getCreatorMe(): Promise<CreatorSupportMe> {
  const account = await requireCreatorAccount();
  const program = await creatorProgram();
  const { id, ...card } = account;
  return {
    account: card, enrollmentOpen: program?.enrollmentOpen === true && program.termsVersion === CREATOR_SUPPORT_TERMS_VERSION,
    termsVersion: CREATOR_SUPPORT_TERMS_VERSION, status: program ? await getCreatorStatus(id) : null,
  };
}
export async function enrollCreator(account: Awaited<ReturnType<typeof requireCreatorAccount>>, input: CreatorEnrollmentInput) {
  assertCreatorAccount(input.accountKey, account);
  let channel: ReturnType<typeof normalizeCreatorChannel>;
  try { channel = normalizeCreatorChannel(input.platform, input.channelUrl); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "채널 주소를 확인해 주세요."); }
  const db = getDb();
  if (!await creatorSchemaReady(db)) throw new HttpError(409, "현재 신규 모집을 준비 중입니다.", "CREATOR_ENROLLMENT_CLOSED");
  const channelHash = createHash("sha256").update(channel.channelKey).digest("hex");
  await db`
    select shorts_mvp.enroll_creator_support(
      ${account.id}::uuid,${input.requestId}::uuid,${input.platform},${channelHash},
      ${channel.channelUrl},${input.channelName},${input.assetId}::uuid,${CREATOR_SUPPORT_TERMS_VERSION},
      ${db.json({ consents: input.consents, ownsChannel: input.ownsChannel, terms: creatorSupportTerms })}::jsonb
    )
  `;
  return getCreatorStatus(account.id, db);
}

/** Uses the existing billing maintenance invocation; grants activate without it. */
export async function maintainCreatorSupport(db: Sql = getDb()) {
  if (!await creatorSchemaReady(db)) return { schemaReady: false, stopped: 0, materialsDeleted: 0 };
  return db.begin(async (tx) => {
    const stopped = await tx`
      update shorts_mvp.creator_support_enrollments e set promotion_status='expired'
      where e.promotion_ends_at<=clock_timestamp() and e.promotion_status in ('pending','approved') returning id
    `;
    for (const row of stopped) await tx`
      insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,action)
      values (${CREATOR_SUPPORT_PROGRAM},${row.id},'promotion_expired')
    `;
    const withdrawn = await tx`
      update shorts_mvp.creator_support_enrollments e set terminated_at=u.withdrawn_at,promotion_status='stopped'
      from shorts_mvp.app_users u where u.id=e.user_id and u.withdrawn_at is not null and e.terminated_at is null
      returning e.id
    `;
    for (const row of withdrawn) await tx`
      insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,action)
      values (${CREATOR_SUPPORT_PROGRAM},${row.id},'account_withdrawn')
    `;
    await tx`
      update shorts_mvp.usage_grants g set status='revoked',updated_at=clock_timestamp()
      from shorts_mvp.creator_support_installments i,shorts_mvp.creator_support_enrollments e
      where i.grant_id=g.id and i.enrollment_id=e.id and e.terminated_at is not null
        and g.valid_from>e.terminated_at and g.status='active'
    `;
    const materials = await tx`
      select id,asset_id from shorts_mvp.creator_support_enrollments
      where (promotion_ends_at<=clock_timestamp() or terminated_at is not null) and material_deleted_at is null
      for update
    `;
    for (const row of materials) {
      await tx`update shorts_mvp.creator_support_enrollments set channel_name=null,channel_url=null,asset_id=null,
        material_deleted_at=clock_timestamp() where id=${row.id}`;
      if (row.assetId) await tx`delete from shorts_mvp.creator_support_assets where id=${row.assetId}`;
      await tx`insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,action)
        values (${CREATOR_SUPPORT_PROGRAM},${row.id},'materials_deleted')`;
    }
    await tx`
      delete from shorts_mvp.creator_support_assets a where a.created_at<clock_timestamp()-interval '1 day'
        and not exists (select 1 from shorts_mvp.creator_support_enrollments e where e.asset_id=a.id)
    `;
    const evidence = await tx`
      update shorts_mvp.creator_support_enrollments set consent_snapshot=null,evidence_deleted_at=clock_timestamp()
      where support_ends_at+interval '1 year'<=clock_timestamp() and evidence_deleted_at is null returning id
    `;
    for (const row of evidence) await tx`delete from shorts_mvp.creator_support_audit where enrollment_id=${row.id}`;
    await tx`
      delete from shorts_mvp.creator_support_enrollments e
      using shorts_mvp.creator_support_programs p
      where p.code=e.program_code and p.retired_at is not null
        and e.support_ends_at+interval '1 year'<=clock_timestamp()
        and e.material_deleted_at is not null and e.evidence_deleted_at is not null
    `;
    await tx`delete from shorts_mvp.creator_support_audit a
      using shorts_mvp.creator_support_programs p where a.program_code=p.code and a.enrollment_id is null
        and p.retired_at+interval '1 year'<=clock_timestamp()`;
    return { schemaReady: true, stopped: stopped.length + withdrawn.length, materialsDeleted: materials.length };
  });
}
