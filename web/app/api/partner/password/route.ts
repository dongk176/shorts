import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createPartnerSession,
  requirePartnerSession,
  revokePartnerSessions,
} from "@/lib/partner-auth";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  createReferralPasswordHash,
  verifyReferralPassword,
} from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

export const runtime = "nodejs";

const passwordSchema = z.object({
  requestId: z.string().uuid(),
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

export async function PATCH(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const [session, body] = await Promise.all([
      requirePartnerSession(),
      request.json().then((value) => passwordSchema.parse(value)),
    ]);
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(400, "새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.");
    }
    const db = getDb();
    const processed = await db`
      select id from shorts_mvp.referral_partner_audit_logs
      where request_id=${body.requestId} and partner_id=${session.partnerId}
      limit 1
    `;
    if (processed[0]) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    const rows = await db`
      select password_hash,password_salt
      from shorts_mvp.referral_partner_credentials
      where partner_id=${session.partnerId}
      limit 1
    `;
    const current = rows[0];
    if (
      !current
      || !await verifyReferralPassword(
        body.currentPassword,
        current.passwordHash,
        current.passwordSalt,
      )
    ) {
      throw new HttpError(401, "현재 비밀번호가 일치하지 않습니다.", "INVALID_CURRENT_PASSWORD");
    }
    const next = await createReferralPasswordHash(body.newPassword);
    await db.begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return;
      await tx`
        update shorts_mvp.referral_partner_credentials
        set password_hash=${next.hash},password_salt=${next.salt},
          password_version=password_version+1,must_change_password=false,
          password_changed_at=now()
        where partner_id=${session.partnerId}
      `;
      await tx`
        update shorts_mvp.referral_partner_sessions
        set revoked_at=coalesce(revoked_at,now())
        where partner_id=${session.partnerId} and revoked_at is null
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,action,entity_type,entity_id
        ) values (
          ${body.requestId},${session.partnerId},'partner','partner.password_changed',
          'referral_partner',${session.partnerId}
        )
      `;
    });
    await revokePartnerSessions(session.partnerId);
    await createPartnerSession(session.partnerId);
    return NextResponse.json({ ok: true, alreadyProcessed: false });
  } catch (error) {
    return apiError(error, "비밀번호를 변경하지 못했습니다.");
  }
}
