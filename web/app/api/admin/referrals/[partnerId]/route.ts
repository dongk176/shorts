import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ partnerId: string }> };

const updateSchema = z.object({
  requestId: z.string().uuid(),
  creatorName: z.string().trim().min(1).max(100),
  recoveryEmail: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
  commissionRateBps: z.number().int().min(0).max(10_000),
  status: z.enum(["active", "paused", "terminated"]),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ partnerId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => updateSchema.parse(value)),
    ]);
    const db = getDb();
    const result = await db.begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return { alreadyProcessed: true };
      const updated = await tx`
        update shorts_mvp.referral_partners
        set creator_name=${body.creatorName},recovery_email=${body.recoveryEmail || null},
          commission_rate_bps=${body.commissionRateBps},status=${body.status},
          terminated_at=case
            when ${body.status}='terminated' then coalesce(terminated_at,now())
            else null
          end
        where id=${partnerId}
        returning id
      `;
      if (!updated[0]) throw new HttpError(404, "레퍼럴 파트너를 찾을 수 없습니다.");
      if (body.status === "terminated") {
        await tx`
          update shorts_mvp.referral_partner_sessions
          set revoked_at=coalesce(revoked_at,now())
          where partner_id=${partnerId} and revoked_at is null
        `;
      }
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id,metadata
        ) values (
          ${body.requestId},${partnerId},'admin',${admin.id},'referral.partner_updated',
          'referral_partner',${partnerId},
          ${tx.json({
            creatorName: body.creatorName,
            commissionRateBps: body.commissionRateBps,
            status: body.status,
          })}
        )
      `;
      return { alreadyProcessed: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "레퍼럴 파트너를 변경하지 못했습니다.");
  }
}
