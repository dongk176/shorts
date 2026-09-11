import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { applicationSchemaReady, maintainCreatorApplications } from "@/lib/creator-application-server";
import { CREATOR_SUPPORT_PROGRAM } from "@/lib/creator-support";
import { creatorError, creatorJson } from "@/lib/creator-support-server";
import { readCreatorJson } from "@/lib/creator-support-upload";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdminUser();
    if (!await applicationSchemaReady()) return creatorJson({ ready: false, items: [], total: 0, selected: 0 });
    const db = getDb(); const params = new URL(request.url).searchParams;
    if (params.has("id")) {
      const id = z.uuid().parse(params.get("id"));
      const [application] = await db`select a.*,u.display_name,u.email,
        coalesce((select jsonb_agg(jsonb_build_object('platform',c.platform,'channelUrl',c.channel_url) order by c.platform desc)
          from shorts_mvp.creator_support_application_channels c where c.application_id=a.id and c.channel_url is not null),'[]'::jsonb) as channels
        from shorts_mvp.creator_support_applications a join shorts_mvp.app_users u on u.id=a.user_id where a.id=${id} and a.program_code=${CREATOR_SUPPORT_PROGRAM}`;
      if (!application) throw new HttpError(404, "신청을 찾을 수 없습니다.");
      const audit = await db`select action,reference,created_at,actor_id from shorts_mvp.creator_support_application_audit where application_id=${id} order by created_at desc`;
      return creatorJson({ application, audit });
    }
    const page = z.coerce.number().int().min(1).max(10000).parse(params.get("page") || 1);
    const state = z.enum(["all", "pending_review", "selected", "rejected", "withdrawn", "expired"]).parse(params.get("state") || "all");
    const [counts] = await db`select count(*) filter(where ${state}='all' or state=${state})::int as total,
      count(*) filter(where selected_at is not null)::int as selected from shorts_mvp.creator_support_applications where program_code=${CREATOR_SUPPORT_PROGRAM}`;
    const items = await db`select a.id,a.state,a.phone_number,a.submitted_at,a.selected_at,a.enrollment_id,u.display_name,u.email,
      coalesce((select jsonb_agg(jsonb_build_object('platform',c.platform,'channelUrl',c.channel_url) order by c.platform desc)
        from shorts_mvp.creator_support_application_channels c where c.application_id=a.id and c.channel_url is not null),'[]'::jsonb) as channels
      from shorts_mvp.creator_support_applications a join shorts_mvp.app_users u on u.id=a.user_id
      where a.program_code=${CREATOR_SUPPORT_PROGRAM} and (${state}='all' or a.state=${state})
      order by a.submitted_at desc,a.id desc limit 25 offset ${(page - 1) * 25}`;
    return creatorJson({ ready: true, items, ...counts, page });
  } catch (error) { return creatorError(error); }
}
const mutation = z.object({ action: z.enum(["select", "reject", "withdraw"]), id: z.uuid(),
  reference: z.string().trim().min(5).max(500), confirmed: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request); const admin = await requireAdminUser();
    const input = mutation.parse(await readCreatorJson(request, 3000));
    if (!await applicationSchemaReady()) throw new HttpError(409, "신청 기능을 준비 중입니다.");
    const db = getDb();
    if (input.action === "select") {
      await db`select shorts_mvp.select_creator_application(${input.id}::uuid,${admin.id}::uuid,${input.reference})`;
    } else {
      await db.begin(async tx => {
        // Match the selection lock order so closing a request cannot race with selection.
        await tx`select code from shorts_mvp.creator_support_programs where code=${CREATOR_SUPPORT_PROGRAM} for update`;
        const [row] = await tx`select id,state from shorts_mvp.creator_support_applications where id=${input.id} and program_code=${CREATOR_SUPPORT_PROGRAM} for update`;
        if (!row) throw new HttpError(404, "신청을 찾을 수 없습니다.");
        const state = input.action === "reject" ? "rejected" : "withdrawn";
        if (row.state === state) return;
        if (row.state !== "pending_review") throw new HttpError(409, "검토 대기 신청만 처리할 수 있습니다. 선정된 참여자의 종료는 지원 관리에서 처리해 주세요.");
        await tx`update shorts_mvp.creator_support_applications set state=${state},reviewed_at=clock_timestamp() where id=${input.id}`;
        await tx`insert into shorts_mvp.creator_support_application_audit(application_id,actor_id,action,reference) values(${input.id},${admin.id},${state},${input.reference})`;
      });
      await maintainCreatorApplications(db);
    }
    return creatorJson({ ok: true });
  } catch (error) { return creatorError(error); }
}
