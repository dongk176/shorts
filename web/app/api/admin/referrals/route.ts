import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  isReferralLoginId,
  isReferralSlug,
  normalizeReferralLoginId,
  normalizeReferralSlug,
} from "@/lib/referral-policy";
import { createReferralPasswordHash } from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

const createSchema = z.object({
  requestId: z.string().uuid(),
  creatorName: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(3).max(32),
  loginId: z.string().trim().min(3).max(32),
  temporaryPassword: z.string().min(10).max(128),
  recoveryEmail: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
  commissionRateBps: z.number().int().min(0).max(10_000).default(2_000),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const [admin, body] = await Promise.all([
      requireAdminUser(),
      request.json().then((value) => createSchema.parse(value)),
    ]);
    const slug = normalizeReferralSlug(body.slug);
    const loginId = normalizeReferralLoginId(body.loginId);
    if (!isReferralSlug(slug)) {
      throw new HttpError(400, "사용할 수 없는 레퍼럴 주소입니다.", "INVALID_REFERRAL_SLUG");
    }
    if (!isReferralLoginId(loginId)) {
      throw new HttpError(400, "사용할 수 없는 파트너 로그인 아이디입니다.", "INVALID_PARTNER_LOGIN_ID");
    }
    const password = await createReferralPasswordHash(body.temporaryPassword);
    const db = getDb();
    const result = await db.begin(async (tx) => {
      const existing = await tx`
        select id,slug from shorts_mvp.referral_partners
        where create_request_id=${body.requestId}
        limit 1
      `;
      if (existing[0]) return { partner: existing[0], alreadyProcessed: true };
      const inserted = await tx`
        insert into shorts_mvp.referral_partners (
          create_request_id,creator_name,slug,commission_rate_bps,recovery_email,
          created_by_user_id
        ) values (
          ${body.requestId},${body.creatorName},${slug},${body.commissionRateBps},
          ${body.recoveryEmail || null},${admin.id}
        )
        returning id,slug
      `;
      const partner = inserted[0];
      await tx`
        insert into shorts_mvp.referral_partner_credentials (
          partner_id,login_id,password_hash,password_salt
        ) values (
          ${partner.id},${loginId},${password.hash},${password.salt}
        )
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id,metadata
        ) values (
          ${body.requestId},${partner.id},'admin',${admin.id},'referral.partner_created',
          'referral_partner',${partner.id},
          ${tx.json({
            slug,
            loginId,
            creatorName: body.creatorName,
            commissionRateBps: body.commissionRateBps,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'referral.partner_created','referral_partner',${partner.id},
          ${tx.json({ slug, loginId, commissionRateBps: body.commissionRateBps })}
        )
      `;
      return { partner, alreadyProcessed: false };
    });
    return NextResponse.json({
      ok: true,
      partnerId: result.partner.id,
      url: `https://www.easycut.co.kr/${result.partner.slug}`,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return apiError(
        new HttpError(409, "이미 사용 중인 주소 또는 로그인 아이디입니다.", "REFERRAL_DUPLICATE"),
      );
    }
    return apiError(error, "레퍼럴 파트너를 생성하지 못했습니다.");
  }
}
