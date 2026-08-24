import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { decryptReferralAccountNumber } from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ partnerId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ partnerId }, admin] = await Promise.all([params, requireAdminUser()]);
    const db = getDb();
    const rows = await db`
      select bank_name,account_holder,account_number_ciphertext,
        account_number_iv,account_number_tag
      from shorts_mvp.referral_partners
      where id=${partnerId}
      limit 1
    `;
    const partner = rows[0];
    if (!partner?.accountNumberCiphertext) {
      throw new HttpError(404, "등록된 정산 계좌가 없습니다.");
    }
    const accountNumber = decryptReferralAccountNumber({
      ciphertext: partner.accountNumberCiphertext,
      iv: partner.accountNumberIv,
      tag: partner.accountNumberTag,
    }, partnerId);
    await db`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},'referral.payout_account_viewed','referral_partner',${partnerId},
        ${db.json({ last4: accountNumber.slice(-4) })}
      )
    `;
    return NextResponse.json({
      bankName: partner.bankName,
      accountHolder: partner.accountHolder,
      accountNumber,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "정산 계좌를 확인하지 못했습니다.");
  }
}
