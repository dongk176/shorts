import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { createReferralPasswordHash } from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ partnerId: string }> };

const resetSchema = z.object({
  requestId: z.string().uuid(),
  temporaryPassword: z.string().min(10).max(128),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ partnerId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => resetSchema.parse(value)),
    ]);
    const password = await createReferralPasswordHash(body.temporaryPassword);
    const result = await getDb().begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return { alreadyProcessed: true };
      const updated = await tx`
        update shorts_mvp.referral_partner_credentials
        set password_hash=${password.hash},password_salt=${password.salt},
          password_version=password_version+1,must_change_password=true,
          password_changed_at=now()
        where partner_id=${partnerId}
        returning partner_id
      `;
      if (!updated[0]) throw new HttpError(404, "레퍼럴 파트너를 찾을 수 없습니다.");
      await tx`
        update shorts_mvp.referral_partner_sessions
        set revoked_at=coalesce(revoked_at,now())
        where partner_id=${partnerId} and revoked_at is null
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id
        ) values (
          ${body.requestId},${partnerId},'admin',${admin.id},'referral.password_reset',
          'referral_partner',${partnerId}
        )
      `;
      return { alreadyProcessed: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "임시 비밀번호를 설정하지 못했습니다.");
  }
}
