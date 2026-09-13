import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { maskedReferralEmail } from "@/lib/referral-policy";
import {
  buildReferralSettlements, emptyReferralMonth, type ReferralMonthlySettlement,
  type ReferralSettlementMonth, type ReferralSettlementPayout,
  referralMonthPeriod, referralKstDate, type ReferralSettlementSnapshot, type ReferralSettlementTransaction,
} from "@/lib/referral-settlement";

type SettlementDb = Sql | TransactionSql;
export type ReferralPartnerSettlementLedger = {
  partnerId: string;
  months: ReferralMonthlySettlement[];
};

export async function loadReferralSettlements(input: {
  partnerId?: string; includeMonths?: string[]; now?: Date; db?: SettlementDb;
} = {}): Promise<ReferralPartnerSettlementLedger[]> {
  const db = input.db ?? getDb();
  const now = input.now ?? new Date();
  // A single SQL statement provides one MVCC snapshot to both the monthly
  // entitlement and its cash ledger. Only explicitly selected safe fields
  // are serialized; bank secrets and partner credentials never leave SQL.
  const rows = await db`
    select p.id as partner_id,
      coalesce((select jsonb_agg(jsonb_build_object('reason',coalesce(c.recognition_reason,state.value->>'reason','original_contract_unverified')))
        from shorts_mvp.referral_commissions c
        cross join lateral (select shorts_mvp.referral_contract_state(c.id) as value) state
        where c.partner_id=p.id and (c.recognition_status<>'verified' or state.value->>'status'<>'verified')),'[]'::jsonb) as reviews,
      coalesce((select jsonb_agg(month_row) from (
        select to_char(i.earned_at at time zone 'Asia/Seoul','YYYY-MM') as month,
          coalesce(sum(i.recognized_amount_krw) filter(where i.available_at<=${now}),0)::bigint as "confirmedSalesKrw",
          coalesce(sum(i.recognized_amount_krw) filter(where i.earned_at<=${now} and i.available_at>${now}),0)::bigint as "waitingSalesKrw",
          coalesce(sum(i.recognized_amount_krw) filter(where i.earned_at>${now}),0)::bigint as "futureSalesKrw",
          coalesce(sum(i.commission_amount_krw),0)::bigint as "commissionKrw",
          coalesce(sum(c.excluded_sales_krw) filter(where i.installment_number=1),0)::bigint as "excludedSalesKrw"
        from shorts_mvp.referral_commission_installments i
        join shorts_mvp.referral_commissions c on c.id=i.commission_id
        where c.partner_id=p.id group by 1
      ) month_row),'[]'::jsonb) as months,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'month',to_char(coalesce(r.settlement_month,r.period_start),'YYYY-MM'),
        'status',r.status,'amountKrw',r.amount_krw,'paidAt',r.paid_at,
        'snapshot',r.settlement_snapshot
      )) from shorts_mvp.referral_payouts r
        where r.partner_id=p.id and r.status in ('draft','paid')),'[]'::jsonb) as payouts
    from shorts_mvp.referral_partners p
    where (${input.partnerId ?? null}::uuid is null or p.id=${input.partnerId ?? null}::uuid)
  `;
  return rows.map((row) => {
    const months = row.months as ReferralSettlementMonth[];
    for (const month of input.includeMonths ?? []) {
      if (!months.some((m) => m.month === month)) months.push(emptyReferralMonth(month));
    }
    const reviews = row.reviews as Array<{reason: string}>;
    for (const month of months) {
      month.reviewCount = reviews.length;
      month.reviewReasons = [...new Set(reviews.map(r => r.reason))];
    }
    return { partnerId: String(row.partnerId),
      months: buildReferralSettlements(months, row.payouts as ReferralSettlementPayout[], now) };
  });
}

export async function loadReferralSettlementTransactions(partnerId: string, month: string, now = new Date(), db: SettlementDb = getDb()): Promise<ReferralSettlementTransaction[]> {
  const period = referralMonthPeriod(month);
  const rows = await db`
    select i.id,i.installment_number,i.installment_count,i.gross_amount_krw as installment_gross_amount_krw,
      i.recognized_amount_krw,i.commission_amount_krw,i.earned_at,i.available_at,
      c.gross_amount_krw,c.refunded_amount_krw,c.commission_rate_bps,o.product_code,o.approved_at,a.email,
      c.original_contract,c.eligible_installment_count,c.commission_basis_krw,c.excluded_sales_krw,
      c.recognition_status,c.recognition_reason,
      payout.status as payout_status,payout.settlement_snapshot,
      coalesce((select sum(item.amount_krw) from shorts_mvp.referral_payout_items item
        where item.payout_id=payout.id and item.installment_id=i.id),0)::bigint as allocated
    from shorts_mvp.referral_commission_installments i
    join shorts_mvp.referral_commissions c on c.id=i.commission_id
    join shorts_mvp.billing_orders o on o.id=c.billing_order_id
    left join shorts_mvp.app_users a on a.id=c.user_id
    left join shorts_mvp.referral_payouts payout on payout.partner_id=c.partner_id
      and payout.settlement_month=${period.periodStart}::date and payout.status in ('draft','paid')
    where c.partner_id=${partnerId}
      and i.earned_at>=${period.periodStart}::timestamp at time zone 'Asia/Seoul'
      and i.earned_at<(${period.periodEnd}::date+1)::timestamp at time zone 'Asia/Seoul'
    order by i.earned_at desc,i.id
  `;
  const iso = (value: Date | string) => new Date(value).toISOString();
  return rows.map((row) => {
    const snapshot = row.settlementSnapshot as ReferralSettlementSnapshot | null;
    const item = snapshot?.installments.find((item) => item.id === row.id);
    return {
      id: String(row.id), memberEmail: maskedReferralEmail(row.email), productCode: String(row.productCode),
      approvedAt: iso(row.approvedAt), earnedAt: iso(row.earnedAt), availableAt: iso(row.availableAt),
      installmentNumber: Number(row.installmentNumber), installmentCount: Number(row.installmentCount),
      grossAmountKrw: Number(row.grossAmountKrw), refundedAmountKrw: Number(row.refundedAmountKrw),
      installmentGrossAmountKrw: item?.grossAmountKrw ?? Number(row.installmentGrossAmountKrw),
      recognizedAmountKrw: item?.recognizedAmountKrw ?? Number(row.recognizedAmountKrw),
      commissionAmountKrw: item?.commissionAmountKrw ?? Number(row.commissionAmountKrw),
      commissionRateBps: item?.commissionRateBps ?? Number(row.commissionRateBps),
      draftAmountKrw: row.payoutStatus === "draft" ? Number(row.allocated) : 0,
      paidAmountKrw: row.payoutStatus === "paid" ? Number(row.allocated) : 0,
      isAvailable: row.recognitionStatus === "verified" && referralKstDate(now) >= period.scheduledPaymentDate && new Date(row.availableAt).getTime() <= now.getTime(),
      settlementMonth: month, scheduledPaymentDate: period.scheduledPaymentDate,
      originalProductCode: row.originalContract?.productCode ?? "미확인",
      originalContractMonths: row.originalContract?.months ?? 0,
      eligibleInstallmentCount: Number(row.eligibleInstallmentCount),
      commissionBasisKrw: Number(row.commissionBasisKrw), excludedSalesKrw: Number(row.excludedSalesKrw),
      recognitionStatus: row.recognitionStatus, recognitionReason: row.recognitionReason,
    };
  });
}

// The detail rows and their summary must see the same refund/payout revision,
// including when a refund arrives while a CSV is being generated.
export async function loadReferralSettlementReport(partnerId: string, month: string, now = new Date(), includeMonths: string[] = []) {
  return getDb().begin("isolation level repeatable read read only", async (tx) => {
    const ledgers = await loadReferralSettlements({ partnerId, includeMonths: [month, ...includeMonths], now, db: tx });
    const transactions = await loadReferralSettlementTransactions(partnerId, month, now, tx);
    return { months: ledgers[0]?.months ?? [], transactions };
  });
}
