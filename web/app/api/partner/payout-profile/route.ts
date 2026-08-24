import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePartnerSession } from "@/lib/partner-auth";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  encryptReferralAccountNumber,
  verifyReferralPassword,
} from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

export const runtime = "nodejs";

const payoutProfileSchema = z.object({
  requestId: z.string().uuid(),
  currentPassword: z.string().min(1).max(128),
  bankName: z.string().trim().min(2).max(50),
  accountHolder: z.string().trim().min(2).max(50),
  accountNumber: z.string().trim().min(8).max(30),
});

export async function PATCH(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const [session, body] = await Promise.all([
      requirePartnerSession(),
      request.json().then((value) => payoutProfileSchema.parse(value)),
    ]);
    const db = getDb();
    const processed = await db`
      select id from shorts_mvp.referral_partner_audit_logs
      where request_id=${body.requestId} and partner_id=${session.partnerId}
      limit 1
    `;
    if (processed[0]) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    const credentialRows = await db`
      select password_hash,password_salt
      from shorts_mvp.referral_partner_credentials
      where partner_id=${session.partnerId}
      limit 1
    `;
    const credential = credentialRows[0];
    if (
      !credential
      || !await verifyReferralPassword(
        body.currentPassword,
        credential.passwordHash,
        credential.passwordSalt,
      )
    ) {
      throw new HttpError(401, "현재 비밀번호가 일치하지 않습니다.", "INVALID_CURRENT_PASSWORD");
    }
    const encrypted = encryptReferralAccountNumber(body.accountNumber, session.partnerId);
    await db.begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return;
      await tx`
        update shorts_mvp.referral_partners
        set bank_name=${body.bankName},account_holder=${body.accountHolder},
          account_number_ciphertext=${encrypted.ciphertext},
          account_number_iv=${encrypted.iv},account_number_tag=${encrypted.tag},
          account_number_last4=${encrypted.last4},payout_profile_updated_at=now()
        where id=${session.partnerId}
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,action,entity_type,entity_id,
          metadata
        ) values (
          ${body.requestId},${session.partnerId},'partner','partner.payout_profile_changed',
          'referral_partner',${session.partnerId},
          ${tx.json({ bankName: body.bankName, accountHolder: body.accountHolder, last4: encrypted.last4 })}
        )
      `;
    });
    return NextResponse.json({
      ok: true,
      alreadyProcessed: false,
      bankName: body.bankName,
      accountHolder: body.accountHolder,
      accountNumberLast4: encrypted.last4,
    });
  } catch (error) {
    return apiError(error, "정산 계좌를 변경하지 못했습니다.");
  }
}
