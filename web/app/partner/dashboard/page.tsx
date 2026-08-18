import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPartnerSession } from "@/lib/partner-auth";
import { maskedReferralEmail } from "@/lib/referral-policy";
import { createNoIndexMetadata } from "@/lib/seo";
import {
  PartnerDashboard,
  type PartnerCampaign,
  type PartnerDashboardMetrics,
  type PartnerPayout,
  type PartnerTransaction,
} from "./partner-dashboard";
import { PartnerFirstPasswordChange } from "./partner-first-password-change";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata(
  "파트너 대시보드",
  "Easy Cut 레퍼럴 파트너 전용 성과 및 정산 화면입니다.",
);

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function kstDate(daysFromToday: number) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + daysFromToday * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function validDate(value: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}

export default async function PartnerDashboardPage({ searchParams }: PageProps) {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.mustChangePassword) {
    return <PartnerFirstPasswordChange creatorName={session.creatorName} />;
  }

  const params = await searchParams;
  const from = validDate(first(params.from), kstDate(-29));
  const to = validDate(first(params.to), kstDate(0));
  const db = getDb();
  const [
    clickRows,
    signupRows,
    salesRows,
    balanceRows,
    transactionRows,
    campaignRows,
    payoutRows,
    profileRows,
  ] = await Promise.all([
    db`
      select count(*)::integer as clicks,
        count(distinct visitor_id)::integer as unique_visitors
      from shorts_mvp.referral_clicks
      where clicked_partner_id=${session.partnerId}
        and occurred_at>=${from}::date at time zone 'Asia/Seoul'
        and occurred_at<(${to}::date+1) at time zone 'Asia/Seoul'
    `,
    db`
      select count(*)::integer as signups
      from shorts_mvp.app_users
      where referral_partner_id=${session.partnerId}
        and referral_attributed_at>=${from}::date at time zone 'Asia/Seoul'
        and referral_attributed_at<(${to}::date+1) at time zone 'Asia/Seoul'
    `,
    db`
      select
        count(*)::integer as paid_orders,
        count(distinct c.user_id)::integer as paid_customers,
        coalesce(sum(c.gross_amount_krw),0)::bigint as gross_sales,
        coalesce(sum(c.refunded_amount_krw),0)::bigint as refunds,
        coalesce(sum(c.gross_amount_krw-c.refunded_amount_krw),0)::bigint as net_sales,
        coalesce((
          select sum(installment.commission_amount_krw)
          from shorts_mvp.referral_commission_installments installment
          join shorts_mvp.referral_commissions period_commission
            on period_commission.id=installment.commission_id
          where period_commission.partner_id=${session.partnerId}
            and installment.earned_at>=${from}::date at time zone 'Asia/Seoul'
            and installment.earned_at<(${to}::date+1) at time zone 'Asia/Seoul'
        ),0)::bigint as commission
      from shorts_mvp.referral_commissions c
      join shorts_mvp.billing_orders o on o.id=c.billing_order_id
      where c.partner_id=${session.partnerId}
        and o.approved_at>=${from}::date at time zone 'Asia/Seoul'
        and o.approved_at<(${to}::date+1) at time zone 'Asia/Seoul'
    `,
    db`
      select
        coalesce(sum(greatest(
          installment.commission_amount_krw-coalesce(allocated.amount_krw,0),
          0
        )) filter (
          where installment.earned_at<=clock_timestamp()
            and installment.available_at>clock_timestamp()
        ),0)::bigint as pending,
        coalesce(sum(greatest(
          installment.commission_amount_krw-coalesce(allocated.amount_krw,0),
          0
        )) filter (
          where installment.earned_at>clock_timestamp()
        ),0)::bigint as future,
        coalesce(sum(installment.commission_amount_krw) filter (
          where installment.available_at<=clock_timestamp()
        ),0)::bigint
          - coalesce((
            select sum(amount_krw) from shorts_mvp.referral_payouts
            where partner_id=${session.partnerId} and status in ('draft','paid')
          ),0)::bigint as available,
        coalesce((
          select sum(amount_krw) from shorts_mvp.referral_payouts
          where partner_id=${session.partnerId} and status='paid'
        ),0)::bigint as paid
      from shorts_mvp.referral_commission_installments installment
      join shorts_mvp.referral_commissions commission
        on commission.id=installment.commission_id
      left join lateral (
        select sum(item.amount_krw)::bigint as amount_krw
        from shorts_mvp.referral_payout_items item
        join shorts_mvp.referral_payouts payout on payout.id=item.payout_id
        where item.installment_id=installment.id
          and payout.status in ('draft','paid')
      ) allocated on true
      where commission.partner_id=${session.partnerId}
    `,
    db`
      select installment.id,installment.installment_number,installment.installment_count,
        installment.gross_amount_krw as installment_gross_amount_krw,
        installment.recognized_amount_krw,installment.commission_amount_krw,
        installment.earned_at,installment.available_at,
        commission.gross_amount_krw,commission.refunded_amount_krw,
        commission.commission_rate_bps,orders.product_code,orders.approved_at,account.email,
        coalesce(allocation.draft_amount_krw,0)::bigint as draft_amount_krw,
        coalesce(allocation.paid_amount_krw,0)::bigint as paid_amount_krw
      from shorts_mvp.referral_commission_installments installment
      join shorts_mvp.referral_commissions commission
        on commission.id=installment.commission_id
      join shorts_mvp.billing_orders orders on orders.id=commission.billing_order_id
      left join shorts_mvp.app_users account on account.id=commission.user_id
      left join lateral (
        select
          sum(item.amount_krw) filter (where payout.status='draft')::bigint
            as draft_amount_krw,
          sum(item.amount_krw) filter (where payout.status='paid')::bigint
            as paid_amount_krw
        from shorts_mvp.referral_payout_items item
        join shorts_mvp.referral_payouts payout on payout.id=item.payout_id
        where item.installment_id=installment.id
      ) allocation on true
      where commission.partner_id=${session.partnerId}
        and installment.earned_at>=${from}::date at time zone 'Asia/Seoul'
        and installment.earned_at<(${to}::date+1) at time zone 'Asia/Seoul'
      order by installment.earned_at desc,orders.approved_at desc
      limit 200
    `,
    db`
      select coalesce(campaign,'직접 링크') as campaign,count(*)::integer as clicks,
        count(distinct visitor_id)::integer as unique_visitors
      from shorts_mvp.referral_clicks
      where clicked_partner_id=${session.partnerId}
        and occurred_at>=${from}::date at time zone 'Asia/Seoul'
        and occurred_at<(${to}::date+1) at time zone 'Asia/Seoul'
      group by coalesce(campaign,'직접 링크')
      order by clicks desc,campaign
    `,
    db`
      select id,period_start,period_end,amount_krw,status,paid_at,created_at,
        transfer_reference
      from shorts_mvp.referral_payouts
      where partner_id=${session.partnerId}
      order by created_at desc
      limit 50
    `,
    db`
      select bank_name,account_holder,account_number_last4,payout_profile_updated_at
      from shorts_mvp.referral_partners
      where id=${session.partnerId}
      limit 1
    `,
  ]);

  const click = clickRows[0] || {};
  const signup = signupRows[0] || {};
  const sales = salesRows[0] || {};
  const balance = balanceRows[0] || {};
  const uniqueVisitors = Number(click.uniqueVisitors || 0);
  const signups = Number(signup.signups || 0);
  const paidCustomers = Number(sales.paidCustomers || 0);
  const metrics: PartnerDashboardMetrics = {
    clicks: Number(click.clicks || 0),
    uniqueVisitors,
    signups,
    paidCustomers,
    signupConversionRate: uniqueVisitors ? signups / uniqueVisitors * 100 : 0,
    paidConversionRate: signups ? paidCustomers / signups * 100 : 0,
    grossSalesKrw: Number(sales.grossSales || 0),
    refundsKrw: Number(sales.refunds || 0),
    netSalesKrw: Number(sales.netSales || 0),
    periodCommissionKrw: Number(sales.commission || 0),
    pendingKrw: Number(balance.pending || 0),
    futureKrw: Number(balance.future || 0),
    availableKrw: Number(balance.available || 0),
    paidKrw: Number(balance.paid || 0),
  };
  const transactions: PartnerTransaction[] = transactionRows.map((row) => ({
    id: row.id,
    memberEmail: maskedReferralEmail(row.email),
    productCode: row.productCode,
    approvedAt: iso(row.approvedAt)!,
    earnedAt: iso(row.earnedAt)!,
    installmentNumber: Number(row.installmentNumber),
    installmentCount: Number(row.installmentCount),
    grossAmountKrw: Number(row.grossAmountKrw),
    refundedAmountKrw: Number(row.refundedAmountKrw),
    installmentGrossAmountKrw: Number(row.installmentGrossAmountKrw),
    recognizedAmountKrw: Number(row.recognizedAmountKrw),
    commissionAmountKrw: Number(row.commissionAmountKrw),
    commissionRateBps: Number(row.commissionRateBps),
    draftAmountKrw: Number(row.draftAmountKrw || 0),
    paidAmountKrw: Number(row.paidAmountKrw || 0),
    availableAt: iso(row.availableAt)!,
    isAvailable: row.availableAt instanceof Date
      ? row.availableAt.getTime() <= Date.now()
      : new Date(String(row.availableAt)).getTime() <= Date.now(),
  }));
  const campaigns: PartnerCampaign[] = campaignRows.map((row) => ({
    campaign: row.campaign,
    clicks: Number(row.clicks),
    uniqueVisitors: Number(row.uniqueVisitors),
  }));
  const payouts: PartnerPayout[] = payoutRows.map((row) => ({
    id: row.id,
    periodStart: String(row.periodStart).slice(0, 10),
    periodEnd: String(row.periodEnd).slice(0, 10),
    amountKrw: Number(row.amountKrw),
    status: row.status,
    paidAt: iso(row.paidAt),
    createdAt: iso(row.createdAt)!,
    transferReference: row.transferReference || null,
  }));
  const profile = profileRows[0] || {};

  return (
    <PartnerDashboard
      creatorName={session.creatorName}
      slug={session.slug}
      status={session.status}
      commissionRateBps={session.commissionRateBps}
      from={from}
      to={to}
      metrics={metrics}
      transactions={transactions}
      campaigns={campaigns}
      payouts={payouts}
      payoutProfile={{
        bankName: profile.bankName || null,
        accountHolder: profile.accountHolder || null,
        accountNumberLast4: profile.accountNumberLast4 || null,
        updatedAt: iso(profile.payoutProfileUpdatedAt),
      }}
    />
  );
}
