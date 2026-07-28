import { getDb } from "@/lib/db";
import {
  AdminReferralsDashboard,
  type AdminReferralPartner,
  type AdminReferralPayout,
} from "./admin-referrals-dashboard";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}

export async function AdminReferralsSection() {
  const db = getDb();
  const [partnerRows, payoutRows] = await Promise.all([
    db`
      select p.id,p.creator_name,p.slug,p.commission_rate_bps,p.status,p.recovery_email,
        p.bank_name,p.account_holder,p.account_number_last4,p.created_at,p.terminated_at,
        c.login_id,
        coalesce(clicks.clicks,0)::integer as clicks,
        coalesce(clicks.unique_visitors,0)::integer as unique_visitors,
        coalesce(signups.signups,0)::integer as signups,
        coalesce(sales.paid_customers,0)::integer as paid_customers,
        coalesce(sales.gross_sales,0)::bigint as gross_sales,
        coalesce(sales.refunds,0)::bigint as refunds,
        coalesce(sales.commission,0)::bigint as commission,
        coalesce(sales.pending,0)::bigint as pending,
        coalesce(sales.available_total,0)::bigint
          - coalesce(paid.paid,0)::bigint
          - coalesce(paid.draft,0)::bigint as available,
        coalesce(paid.paid,0)::bigint as paid
      from shorts_mvp.referral_partners p
      join shorts_mvp.referral_partner_credentials c on c.partner_id=p.id
      left join lateral (
        select count(*)::integer as clicks,
          count(distinct visitor_id)::integer as unique_visitors
        from shorts_mvp.referral_clicks rc
        where rc.clicked_partner_id=p.id
      ) clicks on true
      left join lateral (
        select count(*)::integer as signups
        from shorts_mvp.app_users u
        where u.referral_partner_id=p.id
      ) signups on true
      left join lateral (
        select count(distinct rc.user_id)::integer as paid_customers,
          sum(rc.gross_amount_krw)::bigint as gross_sales,
          sum(rc.refunded_amount_krw)::bigint as refunds,
          sum(rc.commission_amount_krw)::bigint as commission,
          sum(rc.commission_amount_krw) filter (where rc.available_at>now())::bigint as pending,
          sum(rc.commission_amount_krw) filter (where rc.available_at<=now())::bigint as available_total
        from shorts_mvp.referral_commissions rc
        where rc.partner_id=p.id
      ) sales on true
      left join lateral (
        select
          sum(rp.amount_krw) filter (where rp.status='paid')::bigint as paid,
          sum(rp.amount_krw) filter (where rp.status='draft')::bigint as draft
        from shorts_mvp.referral_payouts rp
        where rp.partner_id=p.id
      ) paid on true
      order by p.created_at desc
    `,
    db`
      select r.id,r.partner_id,p.creator_name,p.slug,r.period_start,r.period_end,
        r.amount_krw,r.status,r.account_number_last4_snapshot,r.transfer_reference,
        r.created_at,r.paid_at
      from shorts_mvp.referral_payouts r
      join shorts_mvp.referral_partners p on p.id=r.partner_id
      order by r.created_at desc
      limit 100
    `,
  ]);

  const partners: AdminReferralPartner[] = partnerRows.map((row) => ({
    id: row.id,
    creatorName: row.creatorName,
    slug: row.slug,
    loginId: row.loginId,
    commissionRateBps: Number(row.commissionRateBps),
    status: row.status,
    recoveryEmail: row.recoveryEmail || null,
    bankName: row.bankName || null,
    accountHolder: row.accountHolder || null,
    accountNumberLast4: row.accountNumberLast4 || null,
    createdAt: iso(row.createdAt)!,
    terminatedAt: iso(row.terminatedAt),
    clicks: Number(row.clicks || 0),
    uniqueVisitors: Number(row.uniqueVisitors || 0),
    signups: Number(row.signups || 0),
    paidCustomers: Number(row.paidCustomers || 0),
    grossSalesKrw: Number(row.grossSales || 0),
    refundsKrw: Number(row.refunds || 0),
    commissionKrw: Number(row.commission || 0),
    pendingKrw: Number(row.pending || 0),
    availableKrw: Number(row.available || 0),
    paidKrw: Number(row.paid || 0),
  }));
  const payouts: AdminReferralPayout[] = payoutRows.map((row) => ({
    id: row.id,
    partnerId: row.partnerId,
    creatorName: row.creatorName,
    slug: row.slug,
    periodStart: String(row.periodStart).slice(0, 10),
    periodEnd: String(row.periodEnd).slice(0, 10),
    amountKrw: Number(row.amountKrw),
    status: row.status,
    accountNumberLast4: row.accountNumberLast4Snapshot || null,
    transferReference: row.transferReference || null,
    createdAt: iso(row.createdAt)!,
    paidAt: iso(row.paidAt),
  }));

  return <AdminReferralsDashboard partners={partners} payouts={payouts} />;
}
