import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPartnerSession, clearPartnerSession } from "@/lib/partner-auth";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { isReferralLoginId, normalizeReferralLoginId } from "@/lib/referral-policy";
import { referralRateLimitHash, verifyReferralPassword } from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

export const runtime = "nodejs";

const loginSchema = z.object({
  loginId: z.string().trim().min(3).max(32),
  password: z.string().min(1).max(128),
});

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const body = loginSchema.parse(await request.json());
    const loginId = normalizeReferralLoginId(body.loginId);
    if (!isReferralLoginId(loginId)) {
      throw new HttpError(401, "아이디 또는 비밀번호를 확인해 주세요.", "INVALID_PARTNER_LOGIN");
    }
    const loginHash = referralRateLimitHash(`login:${loginId}`);
    const ipHash = referralRateLimitHash(`ip:${clientAddress(request)}`);
    const db = getDb();
    const attempts = await db`
      with cleared as (
        delete from shorts_mvp.referral_partner_login_attempts
        where attempted_at<now()-interval '1 day'
      )
      select count(*)::integer as failure_count,
        min(attempted_at) as first_failed_at
      from shorts_mvp.referral_partner_login_attempts
      where login_id_hash=${loginHash} and ip_hash=${ipHash}
        and succeeded=false and attempted_at>now()-interval '15 minutes'
    `;
    if (Number(attempts[0]?.failureCount || 0) >= 5) {
      throw new HttpError(
        429,
        "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.",
        "PARTNER_LOGIN_RATE_LIMITED",
        15 * 60,
      );
    }

    const credentialRows = await db`
      select c.partner_id,c.password_hash,c.password_salt,c.must_change_password,
        p.status
      from shorts_mvp.referral_partner_credentials c
      join shorts_mvp.referral_partners p on p.id=c.partner_id
      where c.login_id=${loginId} and p.status in ('active','paused')
      limit 1
    `;
    const credential = credentialRows[0];
    const passwordMatches = credential
      ? await verifyReferralPassword(body.password, credential.passwordHash, credential.passwordSalt)
      : await verifyReferralPassword(body.password, "0".repeat(128), "0".repeat(32));

    if (!credential || !passwordMatches) {
      await db`
        insert into shorts_mvp.referral_partner_login_attempts (
          login_id_hash,ip_hash,succeeded
        ) values (${loginHash},${ipHash},false)
      `;
      throw new HttpError(401, "아이디 또는 비밀번호를 확인해 주세요.", "INVALID_PARTNER_LOGIN");
    }

    await db.begin(async (tx) => {
      await tx`
        delete from shorts_mvp.referral_partner_login_attempts
        where login_id_hash=${loginHash} and ip_hash=${ipHash}
      `;
      await tx`
        insert into shorts_mvp.referral_partner_login_attempts (
          login_id_hash,ip_hash,succeeded
        ) values (${loginHash},${ipHash},true)
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          partner_id,actor_type,action,entity_type,entity_id
        ) values (
          ${credential.partnerId},'partner','partner.login','referral_partner',
          ${credential.partnerId}
        )
      `;
    });
    await createPartnerSession(credential.partnerId);
    return NextResponse.json({
      ok: true,
      mustChangePassword: Boolean(credential.mustChangePassword),
    });
  } catch (error) {
    return apiError(error, "파트너 로그인에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    await clearPartnerSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "로그아웃하지 못했습니다.");
  }
}
