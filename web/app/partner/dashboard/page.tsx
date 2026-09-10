import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPartnerSession } from "@/lib/partner-auth";
import { loadReferralSettlementReport } from "@/lib/referral-settlement-server";
import { defaultReferralMonth, isSettlementMonth, referralKstDate, referralMonthPeriod } from "@/lib/referral-settlement";
import { createNoIndexMetadata } from "@/lib/seo";
import {
  PartnerDashboard,
  type PartnerCampaign,
  type PartnerDashboardMetrics,
  type PartnerPayout,
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
  const now = new Date();
  const month = isSettlementMonth(first(params.month)) ? first(params.month) : defaultReferralMonth(now);
  const currentMonth = referralKstDate(now).slice(0, 7);
  const { periodStart: from, periodEnd: to } = referralMonthPeriod(month);
  const db = getDb();
  const [
    clickRows,
    signupRows,
    salesRows,
    settlementReport,
    campaignRows,
    payoutRows,
    profileRows,
  ] = await Promise.all([
    db`
      select count(*)::integer as clicks,
        count(distinct visitor_id)::integer as unique_visitors
      from shorts_mvp.referral_clicks
      where clicked_partner_id=${session.partnerId}
        and occurred_at>=${from}::timestamp at time zone 'Asia/Seoul'
        and occurred_at<(${to}::date+1)::timestamp at time zone 'Asia/Seoul'
    `,
    db`
      select count(*)::integer as signups
      from shorts_mvp.app_users
      where referral_partner_id=${session.partnerId}
        and referral_attributed_at>=${from}::timestamp at time zone 'Asia/Seoul'
        and referral_attributed_at<(${to}::date+1)::timestamp at time zone 'Asia/Seoul'
    `,
    db`
      select
        count(*)::integer as paid_orders,
        count(distinct c.user_id)::integer as paid_customers
      from shorts_mvp.referral_commissions c
      join shorts_mvp.billing_orders o on o.id=c.billing_order_id
      where c.partner_id=${session.partnerId}
        and o.approved_at>=${from}::timestamp at time zone 'Asia/Seoul'
        and o.approved_at<(${to}::date+1)::timestamp at time zone 'Asia/Seoul'
    `,
    loadReferralSettlementReport(session.partnerId, month, now, [currentMonth]),
    db`
      select coalesce(campaign,'직접 링크') as campaign,count(*)::integer as clicks,
        count(distinct visitor_id)::integer as unique_visitors
      from shorts_mvp.referral_clicks
      where clicked_partner_id=${session.partnerId}
        and occurred_at>=${from}::timestamp at time zone 'Asia/Seoul'
        and occurred_at<(${to}::date+1)::timestamp at time zone 'Asia/Seoul'
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
  };
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
      settlementMonths={settlementReport.months}
      selectedMonth={month}
      currentMonth={currentMonth}
      creatorName={session.creatorName}
      slug={session.slug}
      status={session.status}
      commissionRateBps={session.commissionRateBps}
      from={from}
      to={to}
      metrics={metrics}
      transactions={settlementReport.transactions}
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
