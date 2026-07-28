import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ partnerId: string }> };

const payoutSchema = z.object({
  requestId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ partnerId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => payoutSchema.parse(value)),
    ]);
    const result = await getDb().begin(async (tx) => {
      const existing = await tx`
        select id,amount_krw,status from shorts_mvp.referral_payouts
        where request_id=${body.requestId}
        limit 1
      `;
      if (existing[0]) return { payout: existing[0], alreadyProcessed: true };
      const partnerRows = await tx`
        select * from shorts_mvp.referral_partners
        where id=${partnerId}
        limit 1
        for update
      `;
      const partner = partnerRows[0];
      if (!partner) throw new HttpError(404, "레퍼럴 파트너를 찾을 수 없습니다.");
      if (!partner.accountNumberCiphertext) {
        throw new HttpError(409, "파트너 정산 계좌가 등록되지 않았습니다.", "PAYOUT_PROFILE_REQUIRED");
      }
      const balanceRows = await tx`
        select
          coalesce((
            select sum(c.commission_amount_krw)
            from shorts_mvp.referral_commissions c
            where c.partner_id=${partnerId} and c.available_at<=now()
          ),0)::bigint
          - coalesce((
            select sum(p.amount_krw)
            from shorts_mvp.referral_payouts p
            where p.partner_id=${partnerId} and p.status in ('draft','paid')
          ),0)::bigint as outstanding
      `;
      const outstanding = Number(balanceRows[0]?.outstanding || 0);
      if (outstanding <= 0) {
        throw new HttpError(409, "현재 생성할 수 있는 정산 금액이 없습니다.", "NO_PAYOUT_BALANCE");
      }
      const payouts = await tx`
        insert into shorts_mvp.referral_payouts (
          request_id,partner_id,period_start,period_end,commission_cutoff_at,
          amount_krw,bank_name_snapshot,account_holder_snapshot,
          account_number_ciphertext_snapshot,account_number_iv_snapshot,
          account_number_tag_snapshot,account_number_last4_snapshot,
          note,created_by_user_id
        ) values (
          ${body.requestId},${partnerId},${body.periodStart},${body.periodEnd},now(),
          ${outstanding},${partner.bankName},${partner.accountHolder},
          ${partner.accountNumberCiphertext},${partner.accountNumberIv},
          ${partner.accountNumberTag},${partner.accountNumberLast4},
          ${body.note || null},${admin.id}
        )
        returning id,amount_krw,status
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id,metadata
        ) values (
          ${body.requestId},${partnerId},'admin',${admin.id},'referral.payout_created',
          'referral_payout',${payouts[0].id},
          ${tx.json({
            amountKrw: outstanding,
            periodStart: body.periodStart,
            periodEnd: body.periodEnd,
          })}
        )
      `;
      return { payout: payouts[0], alreadyProcessed: false };
    });
    return NextResponse.json({
      ok: true,
      payoutId: result.payout.id,
      amountKrw: Number(result.payout.amountKrw),
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return apiError(new HttpError(409, "이미 생성된 정산 기간입니다.", "PAYOUT_PERIOD_DUPLICATE"));
    }
    return apiError(error, "정산을 생성하지 못했습니다.");
  }
}
