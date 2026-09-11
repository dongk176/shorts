import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { getDb } from "./db";
import { HttpError } from "./http";
import { CREATOR_SUPPORT_PROGRAM, normalizeCreatorChannel, type CreatorSupportMe } from "./creator-support";
import { assertCreatorAccount, creatorProgram, getCreatorMe, requireCreatorAccount } from "./creator-support-server";
import { CREATOR_APPLICATION_TERMS_VERSION, creatorApplicationTerms, normalizeApplicationPhone, type CreatorApplication, type CreatorApplicationInput } from "./creator-application";

export type CreatorApplicationMe = CreatorSupportMe & { application: CreatorApplication | null };
export async function applicationSchemaReady(db: Sql = getDb()) {
  const [row] = await db`select to_regclass('shorts_mvp.creator_support_applications') is not null as ready`;
  return row?.ready === true;
}
export async function getCreatorApplication(userId: string, db: Sql = getDb()): Promise<CreatorApplication | null> {
  const [row] = await db`select a.*,
    coalesce((select jsonb_agg(jsonb_build_object('platform',c.platform,'channelUrl',c.channel_url) order by c.platform desc)
      from shorts_mvp.creator_support_application_channels c where c.application_id=a.id and c.channel_url is not null),'[]'::jsonb) as channels
    from shorts_mvp.creator_support_applications a where program_code=${CREATOR_SUPPORT_PROGRAM} and user_id=${userId}`;
  if (!row) return null;
  return { id: row.id, state: row.state, phoneNumber: row.phoneNumber, channels: row.channels,
    submittedAt: new Date(row.submittedAt).toISOString(), selectedAt: row.selectedAt ? new Date(row.selectedAt).toISOString() : null,
    enrollmentId: row.enrollmentId };
}
export async function getCreatorApplicationMe(): Promise<CreatorApplicationMe> {
  const me = await getCreatorMe();
  const account = await requireCreatorAccount();
  const program = await creatorProgram();
  const ready = await applicationSchemaReady();
  return { ...me, termsVersion: CREATOR_APPLICATION_TERMS_VERSION,
    enrollmentOpen: ready && program?.enrollmentOpen === true && program.termsVersion === CREATOR_APPLICATION_TERMS_VERSION
      && program.legalReviewVersion === CREATOR_APPLICATION_TERMS_VERSION && Boolean(program.legalReviewedAt),
    application: ready ? await getCreatorApplication(account.id) : null };
}
export async function submitCreatorApplication(account: Awaited<ReturnType<typeof requireCreatorAccount>>, input: CreatorApplicationInput) {
  assertCreatorAccount(input.accountKey, account);
  if (!await applicationSchemaReady()) throw new HttpError(409, "지금은 신규 모집을 준비 중이에요.", "CREATOR_ENROLLMENT_CLOSED");
  const channels = input.channels.map((item) => {
    const normalized = normalizeCreatorChannel(item.platform, item.channelUrl);
    return { platform: item.platform, channelUrl: normalized.channelUrl, channelHash: createHash("sha256").update(normalized.channelKey).digest("hex") };
  });
  const phone = normalizeApplicationPhone(input.phoneNumber);
  const db = getDb();
  await db`select shorts_mvp.submit_creator_application(${account.id}::uuid,${input.requestId}::uuid,${phone},${db.json(channels)}::jsonb,
    ${input.termsVersion},${db.json({ consents: input.consents, ownsChannel: input.ownsChannel, terms: creatorApplicationTerms })}::jsonb)`;
  return getCreatorApplication(account.id, db);
}

/** Called from existing maintenance; no effect on legacy enrollments or grant amounts. */
export async function maintainCreatorApplications(db: Sql = getDb()) {
  if (!await applicationSchemaReady(db)) return;
  await db.begin(async tx => {
    const ended = await tx`update shorts_mvp.creator_support_applications a set
      state=case when u.withdrawn_at is not null then 'withdrawn' else 'expired' end,
      reviewed_at=coalesce(a.reviewed_at,clock_timestamp())
      from shorts_mvp.app_users u where u.id=a.user_id and a.state='pending_review'
        and (u.withdrawn_at is not null or a.submitted_at<=clock_timestamp()-interval '90 days') returning a.id`;
    for (const row of ended) await tx`insert into shorts_mvp.creator_support_application_audit(application_id,action) values(${row.id},'application_closed')`;
    await tx`update shorts_mvp.creator_support_applications a set phone_number=null
      where phone_number is not null and (state in ('rejected','withdrawn','expired')
        or exists(select 1 from shorts_mvp.app_users u where u.id=a.user_id and u.withdrawn_at is not null)
        or exists(select 1 from shorts_mvp.creator_support_enrollments e where e.id=a.enrollment_id and (e.terminated_at is not null or e.support_ends_at<=clock_timestamp())))`;
    const expired = await tx`update shorts_mvp.creator_support_applications a set personal_data_deleted_at=clock_timestamp()
      where personal_data_deleted_at is null and (state in ('rejected','withdrawn','expired')
        or exists(select 1 from shorts_mvp.app_users u where u.id=a.user_id and u.withdrawn_at is not null)
        or exists(select 1 from shorts_mvp.creator_support_enrollments e where e.id=a.enrollment_id and (e.terminated_at is not null or e.promotion_ends_at<=clock_timestamp()))) returning id`;
    for (const row of expired) await tx`update shorts_mvp.creator_support_application_channels set channel_url=null where application_id=${row.id}`;
    const evidence = await tx`update shorts_mvp.creator_support_applications a set consent_snapshot=null
      where consent_snapshot is not null and ((enrollment_id is null and (state in ('rejected','withdrawn','expired') or submitted_at<=clock_timestamp()-interval '90 days'))
        or exists(select 1 from shorts_mvp.creator_support_enrollments e where e.id=a.enrollment_id and e.support_ends_at+interval '1 year'<=clock_timestamp())) returning id`;
    for (const row of evidence) await tx`delete from shorts_mvp.creator_support_application_audit where application_id=${row.id}`;
    await tx`delete from shorts_mvp.creator_support_applications a using shorts_mvp.creator_support_programs p
      where p.code=a.program_code and p.retired_at is not null and a.personal_data_deleted_at is not null and a.consent_snapshot is null
        and (a.enrollment_id is null or exists(select 1 from shorts_mvp.creator_support_enrollments e where e.id=a.enrollment_id and e.support_ends_at+interval '1 year'<=clock_timestamp()))`;
  });
}
