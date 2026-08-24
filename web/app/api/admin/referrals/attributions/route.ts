import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

const attributionSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  partnerId: z.string().uuid().nullable(),
  reason: z.string().trim().min(2).max(500),
});

export async function PATCH(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const [admin, body] = await Promise.all([
      requireAdminUser(),
      request.json().then((value) => attributionSchema.parse(value)),
    ]);
    const result = await getDb().begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return { alreadyProcessed: true };
      if (body.partnerId) {
        const partner = await tx`
          select id from shorts_mvp.referral_partners
          where id=${body.partnerId} and status in ('active','paused')
          limit 1
        `;
        if (!partner[0]) throw new HttpError(404, "지정할 레퍼럴 파트너를 찾을 수 없습니다.");
      }
      const userRows = await tx`
        select referral_partner_id from shorts_mvp.app_users
        where id=${body.userId}
        limit 1
        for update
      `;
      const user = userRows[0];
      if (!user) throw new HttpError(404, "회원을 찾을 수 없습니다.");
      await tx`
        update shorts_mvp.app_users
        set referral_partner_id=${body.partnerId},referral_visitor_id=null,
          referral_attributed_at=case when ${body.partnerId}::uuid is null then null else now() end
        where id=${body.userId}
      `;
      await tx`
        insert into shorts_mvp.referral_attribution_audits (
          user_id,previous_partner_id,new_partner_id,changed_by_user_id,reason
        ) values (
          ${body.userId},${user.referralPartnerId},${body.partnerId},${admin.id},${body.reason}
        )
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id,metadata
        ) values (
          ${body.requestId},${body.partnerId || user.referralPartnerId},'admin',${admin.id},
          'referral.attribution_changed','app_user',${body.userId},
          ${tx.json({
            previousPartnerId: user.referralPartnerId || null,
            newPartnerId: body.partnerId,
            reason: body.reason,
          })}
        )
      `;
      return { alreadyProcessed: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "추천인을 변경하지 못했습니다.");
  }
}
