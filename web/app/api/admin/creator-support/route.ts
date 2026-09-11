import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { CREATOR_SUPPORT_PROGRAM, CREATOR_SUPPORT_TERMS_VERSION } from "@/lib/creator-support";
import { creatorError, creatorJson, creatorProgram, getCreatorStatus, maintainCreatorSupport } from "@/lib/creator-support-server";
import { readCreatorJson } from "@/lib/creator-support-upload";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const program = await creatorProgram();
    if (!program) return creatorJson({ schemaReady: false, program: null, items: [], total: 0 });
    const db = getDb();
    const params = new URL(request.url).searchParams;
    if (params.has("id")) {
      const id = z.uuid().parse(params.get("id"));
      const [enrollment] = await db`select * from shorts_mvp.creator_support_enrollments where id=${id} and program_code=${CREATOR_SUPPORT_PROGRAM}`;
      if (!enrollment) throw new HttpError(404, "신청을 찾을 수 없습니다.");
      const audit = await db`select action,reference,created_at,actor_id from shorts_mvp.creator_support_audit where enrollment_id=${id} order by created_at desc`;
      return creatorJson({ enrollment, status: await getCreatorStatus(enrollment.userId), audit });
    }
    const eligible = params.get("eligible") === "true";
    const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
    const rows = await db`
      select e.id,e.channel_name,e.channel_url,e.platform,e.activated_at,e.support_ends_at,e.promotion_ends_at,
        e.terminated_at,e.rights_verified_at,e.takedown_completed_at,u.email,u.display_name,
        case when e.terminated_at is not null or u.withdrawn_at is not null then 'stopped'
          when e.promotion_ends_at<=clock_timestamp() then 'expired' else e.promotion_status end as promotion_status,
        (e.promotion_status='approved' and e.rights_verified_at is not null and e.terminated_at is null
          and u.withdrawn_at is null and e.promotion_ends_at>clock_timestamp() and e.channel_url is not null) as eligible,
        count(*) over()::int as total
      from shorts_mvp.creator_support_enrollments e join shorts_mvp.app_users u on u.id=e.user_id
      where e.program_code=${CREATOR_SUPPORT_PROGRAM}
        and (not ${eligible} or (e.promotion_status='approved' and e.rights_verified_at is not null and e.terminated_at is null
          and u.withdrawn_at is null and e.promotion_ends_at>clock_timestamp() and e.channel_url is not null))
      order by e.activated_at desc limit 25 offset ${(page - 1) * 25}
    `;
    return creatorJson({ schemaReady: true, program, items: rows, total: rows[0]?.total || 0, page });
  } catch (error) { return creatorError(error); }
}

const reference = z.string().trim().min(5).max(500);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("legal_review"), reference, reviewed: z.literal(true) }).strict(),
  z.object({ action: z.literal("recruitment"), open: z.boolean() }).strict(),
  z.object({ action: z.literal("verify_rights"), id: z.uuid(), reference, verified: z.literal(true) }).strict(),
  z.object({ action: z.literal("stop"), id: z.uuid(), reference }).strict(),
  z.object({ action: z.literal("takedown_complete"), id: z.uuid(), reference }).strict(),
  z.object({ action: z.literal("maintenance") }).strict(),
  z.object({ action: z.literal("retire"), reference, confirmed: z.literal(true) }).strict(),
]);
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const admin = await requireAdminUser();
    const input = mutation.parse(await readCreatorJson(request, 3000));
    const db = getDb();
    if (!await creatorProgram(db)) throw new HttpError(409, "먼저 크리에이터 지원 데이터베이스 변경을 적용해 주세요.");
    if (input.action === "maintenance") return creatorJson(await maintainCreatorSupport(db));
    await db.begin(async (tx) => {
      const [program] = await tx`select * from shorts_mvp.creator_support_programs where code=${CREATOR_SUPPORT_PROGRAM} for update`;
      if (input.action === "legal_review") {
        if (program.termsVersion !== CREATOR_SUPPORT_TERMS_VERSION) throw new HttpError(409, "배포된 약관 버전과 데이터베이스 버전을 확인해 주세요.");
        await tx`update shorts_mvp.creator_support_programs set legal_review_version=${CREATOR_SUPPORT_TERMS_VERSION},
          legal_review_reference=${input.reference},legal_reviewed_at=clock_timestamp(),legal_reviewed_by=${admin.id},updated_at=clock_timestamp()
          where code=${CREATOR_SUPPORT_PROGRAM}`;
      } else if (input.action === "retire") {
        await tx`update shorts_mvp.creator_support_programs set enrollment_open=false,retired_at=coalesce(retired_at,clock_timestamp()),updated_at=clock_timestamp() where code=${CREATOR_SUPPORT_PROGRAM}`;
      } else if (input.action === "recruitment") {
        if (input.open && program.retiredAt) throw new HttpError(409, "영구 종료한 프로그램은 다시 모집할 수 없습니다.");
        if (input.open && (program.legalReviewVersion !== CREATOR_SUPPORT_TERMS_VERSION || !program.legalReviewedAt || program.termsVersion !== CREATOR_SUPPORT_TERMS_VERSION)) {
          throw new HttpError(409, "현재 이용약정의 법률 검토 완료 기록을 먼저 등록해 주세요.");
        }
        await tx`update shorts_mvp.creator_support_programs set enrollment_open=${input.open},updated_at=clock_timestamp() where code=${CREATOR_SUPPORT_PROGRAM}`;
      } else {
        const [row] = await tx`select e.*,u.withdrawn_at from shorts_mvp.creator_support_enrollments e
          join shorts_mvp.app_users u on u.id=e.user_id where e.id=${input.id} and e.program_code=${CREATOR_SUPPORT_PROGRAM} for update of e`;
        if (!row) throw new HttpError(404, "신청을 찾을 수 없습니다.");
        if (input.action === "verify_rights") {
          if (row.terminatedAt || row.withdrawnAt || !row.channelUrl || new Date(row.promotionEndsAt).getTime() <= Date.now()) throw new HttpError(409, "종료된 신청은 홍보에 사용할 수 없습니다.");
          await tx`update shorts_mvp.creator_support_enrollments set promotion_status='approved',rights_verified_at=clock_timestamp(),rights_verified_by=${admin.id} where id=${row.id}`;
        } else if (input.action === "stop") {
          const [stopped] = await tx`update shorts_mvp.creator_support_enrollments set promotion_status='stopped',
            terminated_at=coalesce(terminated_at,clock_timestamp()),channel_name=null,channel_url=null,asset_id=null,
            material_deleted_at=coalesce(material_deleted_at,clock_timestamp()) where id=${row.id} returning terminated_at`;
          await tx`update shorts_mvp.usage_grants g set status='revoked',updated_at=clock_timestamp()
            from shorts_mvp.creator_support_installments i where i.enrollment_id=${row.id} and i.grant_id=g.id
              and g.valid_from>${stopped.terminatedAt} and g.status='active'`;
          if (row.assetId) await tx`delete from shorts_mvp.creator_support_assets where id=${row.assetId}`;
        } else {
          if (!row.terminatedAt && new Date(row.promotionEndsAt).getTime() > Date.now()) throw new HttpError(409, "홍보 중단 또는 기간 종료 후 처리해 주세요.");
          await tx`update shorts_mvp.creator_support_enrollments set takedown_completed_at=clock_timestamp() where id=${row.id}`;
        }
      }
      await tx`insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,actor_id,action,reference)
        values (${CREATOR_SUPPORT_PROGRAM},${"id" in input ? input.id : null},${admin.id},
          ${input.action === "recruitment" ? input.open ? "recruitment_opened" : "recruitment_closed" : input.action},
          ${"reference" in input ? input.reference : null})`;
    });
    return creatorJson({ ok: true });
  } catch (error) { return creatorError(error); }
}
