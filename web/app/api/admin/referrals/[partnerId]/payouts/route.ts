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
    if (body.periodEnd < body.periodStart) {
      throw new HttpError(400, "정산 종료일은 시작일보다 빠를 수 없습니다.", "INVALID_PAYOUT_PERIOD");
    }
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
      await tx`
        select installment.id
        from shorts_mvp.referral_commission_installments installment
        join shorts_mvp.referral_commissions commission
          on commission.id=installment.commission_id
        where commission.partner_id=${partnerId}
          and installment.available_at<=clock_timestamp()
          and (installment.earned_at at time zone 'Asia/Seoul')::date
            between ${body.periodStart}::date and ${body.periodEnd}::date
        order by installment.earned_at,installment.id
        for update of installment
      `;
      const balanceRows = await tx`
        with installment_allocations as (
          select item.installment_id,sum(item.amount_krw)::bigint as amount_krw
          from shorts_mvp.referral_payout_items item
          join shorts_mvp.referral_payouts payout on payout.id=item.payout_id
          where payout.status in ('draft','paid')
          group by item.installment_id
        )
        select
          coalesce((
            select sum(greatest(
              installment.commission_amount_krw-coalesce(allocation.amount_krw,0),
              0
            ))
            from shorts_mvp.referral_commission_installments installment
            join shorts_mvp.referral_commissions commission
              on commission.id=installment.commission_id
            left join installment_allocations allocation
              on allocation.installment_id=installment.id
            where commission.partner_id=${partnerId}
              and installment.available_at<=clock_timestamp()
              and (installment.earned_at at time zone 'Asia/Seoul')::date
                between ${body.periodStart}::date and ${body.periodEnd}::date
          ),0)::bigint as period_outstanding,
          coalesce((
            select sum(installment.commission_amount_krw)
            from shorts_mvp.referral_commission_installments installment
            join shorts_mvp.referral_commissions commission
              on commission.id=installment.commission_id
            where commission.partner_id=${partnerId}
              and installment.available_at<=clock_timestamp()
          ),0)::bigint
          - coalesce((
            select sum(payout.amount_krw)
            from shorts_mvp.referral_payouts payout
            where payout.partner_id=${partnerId}
              and payout.status in ('draft','paid')
          ),0)::bigint as global_outstanding
      `;
      const periodOutstanding = Number(balanceRows[0]?.periodOutstanding || 0);
      const globalOutstanding = Number(balanceRows[0]?.globalOutstanding || 0);
      const outstanding = Math.min(
        Math.max(0, periodOutstanding),
        Math.max(0, globalOutstanding),
      );
      if (outstanding <= 0) {
        throw new HttpError(
          409,
          "선택한 기간에 현재 지급할 수 있는 월별 수익이 없습니다.",
          "NO_PAYOUT_BALANCE",
        );
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
        with candidates as (
          select
            installment.id,
            installment.earned_at,
            greatest(
              installment.commission_amount_krw-coalesce((
                select sum(item.amount_krw)
                from shorts_mvp.referral_payout_items item
                join shorts_mvp.referral_payouts active_payout
                  on active_payout.id=item.payout_id
                where item.installment_id=installment.id
                  and active_payout.status in ('draft','paid')
              ),0),
              0
            )::integer as remaining
          from shorts_mvp.referral_commission_installments installment
          join shorts_mvp.referral_commissions commission
            on commission.id=installment.commission_id
          where commission.partner_id=${partnerId}
            and installment.available_at<=clock_timestamp()
            and (installment.earned_at at time zone 'Asia/Seoul')::date
              between ${body.periodStart}::date and ${body.periodEnd}::date
        ), ranked as (
          select *,coalesce(sum(remaining) over (
            order by earned_at,id
            rows between unbounded preceding and 1 preceding
          ),0)::bigint as allocated_before
          from candidates
          where remaining>0
        )
        insert into shorts_mvp.referral_payout_items (
          payout_id,installment_id,amount_krw
        )
        select
          ${payouts[0].id},id,
          least(remaining,greatest(${outstanding}-allocated_before,0))::integer
        from ranked
        where allocated_before<${outstanding}
          and least(remaining,greatest(${outstanding}-allocated_before,0))>0
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
            periodOutstandingKrw: periodOutstanding,
            globalOutstandingKrw: globalOutstanding,
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
