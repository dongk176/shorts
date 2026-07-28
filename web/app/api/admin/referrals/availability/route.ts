import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  isReferralLoginId,
  isReferralSlug,
  normalizeReferralLoginId,
  normalizeReferralSlug,
} from "@/lib/referral-policy";

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
    const slug = normalizeReferralSlug(request.nextUrl.searchParams.get("slug") || "");
    const loginId = normalizeReferralLoginId(request.nextUrl.searchParams.get("loginId") || "");
    const validSlug = isReferralSlug(slug);
    const validLoginId = isReferralLoginId(loginId);
    const rows = await getDb()`
      select
        exists(
          select 1 from shorts_mvp.referral_partners
          where ${validSlug}=true and slug=${slug}
        ) as slug_exists,
        exists(
          select 1 from shorts_mvp.referral_partner_credentials
          where ${validLoginId}=true and login_id=${loginId}
        ) as login_id_exists
    `;
    return NextResponse.json({
      slugAvailable: validSlug && !Boolean(rows[0]?.slugExists),
      loginIdAvailable: validLoginId && !Boolean(rows[0]?.loginIdExists),
    });
  } catch (error) {
    return apiError(error, "사용 가능 여부를 확인하지 못했습니다.");
  }
}
