import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ payoutId: string }> };

const payoutUpdateSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["paid", "canceled"]),
  transferReference: z.string().trim().max(200).optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ payoutId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => payoutUpdateSchema.parse(value)),
    ]);
    if (body.action === "paid" && !body.transferReference) {
      throw new HttpError(400, "이체 확인값을 입력해 주세요.", "TRANSFER_REFERENCE_REQUIRED");
    }
    const result = await getDb().begin(async (tx) => {
      const duplicate = await tx`
        select id from shorts_mvp.referral_partner_audit_logs
        where request_id=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return { alreadyProcessed: true };
      const payoutRows = await tx`
        select * from shorts_mvp.referral_payouts
        where id=${payoutId}
        limit 1
        for update
      `;
      const payout = payoutRows[0];
      if (!payout) throw new HttpError(404, "정산 내역을 찾을 수 없습니다.");
      if (payout.status !== "draft") {
        throw new HttpError(409, "대기 중인 정산만 처리할 수 있습니다.");
      }
      let finalAmountKrw = Number(payout.amountKrw);
      if (body.action === "paid") {
        const balanceRows = await tx`
          select
            coalesce((
              select sum(c.commission_amount_krw)
              from shorts_mvp.referral_commissions c
              where c.partner_id=${payout.partnerId} and c.available_at<=now()
            ),0)::bigint
            - coalesce((
              select sum(p.amount_krw)
              from shorts_mvp.referral_payouts p
              where p.partner_id=${payout.partnerId} and p.status='paid'
            ),0)::bigint
            - coalesce((
              select sum(p.amount_krw)
              from shorts_mvp.referral_payouts p
              where p.partner_id=${payout.partnerId} and p.status='draft'
                and p.id<>${payoutId}
            ),0)::bigint as payable_now
        `;
        finalAmountKrw = Math.min(
          Number(payout.amountKrw),
          Math.max(0, Number(balanceRows[0]?.payableNow || 0)),
        );
        if (finalAmountKrw <= 0) {
          throw new HttpError(
            409,
            "환불 조정 후 지급할 정산 금액이 없습니다. 정산을 취소해 주세요.",
            "PAYOUT_BALANCE_REVERSED",
          );
        }
      }
      await tx`
        update shorts_mvp.referral_payouts
        set status=${body.action},amount_krw=${finalAmountKrw},
          paid_by_user_id=case when ${body.action}='paid' then ${admin.id} else null end,
          paid_at=case when ${body.action}='paid' then now() else null end,
          canceled_at=case when ${body.action}='canceled' then now() else null end,
          transfer_reference=case
            when ${body.action}='paid' then ${body.transferReference || null}
            else transfer_reference
          end
        where id=${payoutId}
      `;
      await tx`
        insert into shorts_mvp.referral_partner_audit_logs (
          request_id,partner_id,actor_type,actor_admin_user_id,action,
          entity_type,entity_id,metadata
        ) values (
          ${body.requestId},${payout.partnerId},'admin',${admin.id},
          ${body.action === "paid" ? "referral.payout_paid" : "referral.payout_canceled"},
          'referral_payout',${payoutId},
          ${tx.json({
            amountKrw: finalAmountKrw,
            originalDraftAmountKrw: Number(payout.amountKrw),
            transferReference: body.transferReference || null,
          })}
        )
      `;
      return { alreadyProcessed: false, amountKrw: finalAmountKrw };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "정산 상태를 변경하지 못했습니다.");
  }
}
