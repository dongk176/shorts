import "server-only";

import { addKstMonths } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { getPrepaidPackageMonthState } from "@/lib/refund-policy";
import type { AdminOrder } from "@/app/admin/easycutcutcutcutcutcut/admin-billing-dashboard";

export const ADMIN_BILLING_ORDER_PAGE_SIZE = 100;

export type AdminBillingOrderFilters = {
  status: string;
  provider: string;
  query: string;
};

export type AdminBillingOrderPage = {
  orders: AdminOrder[];
  hasMore: boolean;
  nextOffset: number;
};

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : value
      ? new Date(String(value)).toISOString()
      : null;
}

function toAdminOrder(row: Record<string, unknown>): AdminOrder {
  const contractStart = row.renewalPeriodStart instanceof Date
    ? row.renewalPeriodStart
    : row.approvedAt instanceof Date
      ? row.approvedAt
      : null;
  const contractMonths = row.billingCycle === "yearly"
    ? Number(row.prepaidMonths || 12)
    : 1;
  const packageMonthState = contractStart
    ? getPrepaidPackageMonthState({
      periodStart: contractStart,
      prepaidMonths: contractMonths,
    })
    : null;
  const isInCurrentPackageMonth = (value: unknown) => (
    value instanceof Date
    && packageMonthState?.currentMonthStart instanceof Date
    && packageMonthState.currentMonthEnd instanceof Date
    && value >= packageMonthState.currentMonthStart
    && value < packageMonthState.currentMonthEnd
  );

  return {
    id: String(row.id),
    orderId: String(row.orderId),
    kind: String(row.kind),
    productCode: row.productCode ? String(row.productCode) : "unknown",
    billingCycle: row.billingCycle ? String(row.billingCycle) : null,
    prepaidMonths: contractMonths,
    refundPolicyVersion: Number(row.refundPolicyVersion || 1),
    amountKrw: Number(row.amountKrw),
    refundedAmountKrw: Number(row.refundedAmountKrw || 0),
    reservedRefundKrw: Number(row.reservedRefundKrw || 0),
    refundStatus: String(row.refundStatus),
    status: String(row.status),
    provider: String(row.provider),
    providerTransactionId: row.providerTransactionId ? String(row.providerTransactionId) : null,
    providerStatus: row.providerStatus ? String(row.providerStatus) : null,
    providerTerminalId: row.providerTerminalId ? String(row.providerTerminalId) : null,
    hasPaymentMethod: Boolean(row.hasPaymentMethod),
    credentialScope: row.credentialScope ? String(row.credentialScope) : null,
    installmentMonths: Number(row.installmentMonths || 0),
    cardIssuerName: row.cardIssuerName ? String(row.cardIssuerName) : null,
    installmentBenefitType: row.installmentBenefitType ? String(row.installmentBenefitType) : null,
    declaredCardKind: row.declaredCardKind ? String(row.declaredCardKind) : null,
    failureCode: row.failureCode ? String(row.failureCode) : null,
    approvedAt: iso(row.approvedAt),
    createdAt: iso(row.createdAt)!,
    email: row.email ? String(row.email) : "-",
    subscriptionStatus: row.subscriptionStatus ? String(row.subscriptionStatus) : null,
    contractPeriodStart: iso(contractStart),
    contractPeriodEnd: contractStart
      ? addKstMonths(contractStart, contractMonths).toISOString()
      : null,
    currentPackageMonthUsed:
      isInCurrentPackageMonth(row.lastBaseAllocatedAt)
      || isInCurrentPackageMonth(row.popularFilterLastUsedAt)
      || isInCurrentPackageMonth(row.ebookLastDownloadedAt),
    firstCompletedJobAt: iso(row.firstCompletedJobAt),
    popularFilterUsageCount: Number(row.popularFilterUsageCount || 0),
    popularFilterLastUsedAt: iso(row.popularFilterLastUsedAt),
  };
}

export async function loadAdminBillingOrders({
  filters,
  offset = 0,
}: {
  filters: AdminBillingOrderFilters;
  offset?: number;
}): Promise<AdminBillingOrderPage> {
  const db = getDb();
  const rows = await db`
    select o.id,o.order_id,o.kind,o.product_code,o.billing_cycle,o.amount_krw,
      o.refunded_amount_krw,o.refund_status,o.status,o.provider,o.provider_transaction_id,
      o.provider_status,o.failure_code,o.provider_terminal_id,o.installment_months,
      (o.payment_method_id is not null) as has_payment_method,
      nullif(o.installment_terms_snapshot->>'credentialScope','') as credential_scope,
      coalesce(
        nullif(o.installment_terms_snapshot->>'issuerName',''),
        nullif(pm.issuer_name,'')
      ) as card_issuer_name,
      nullif(o.installment_terms_snapshot->>'benefitType','') as installment_benefit_type,
      nullif(o.installment_terms_snapshot->>'declaredCardKind','') as declared_card_kind,
      o.renewal_period_start,o.approved_at,o.created_at,o.refund_policy_version,u.email,
      s.status as subscription_status,p.prepaid_months,
      coalesce(ur.reserved_refund_krw,0)::integer as reserved_refund_krw,
      coalesce(pfu.usage_count,0)::integer as popular_filter_usage_count,
      pfu.last_used_at as popular_filter_last_used_at,
      bua.last_allocated_at as last_base_allocated_at,
      ebook.last_downloaded_at as ebook_last_downloaded_at,
      first_job.completed_at as first_completed_job_at
    from shorts_mvp.billing_orders o
    join shorts_mvp.app_users u on u.id=o.user_id
    left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
    left join shorts_mvp.plans p on p.code=o.product_code
    left join shorts_mvp.billing_payment_methods pm on pm.id=o.payment_method_id
    left join (
      select source_order_id, sum(refund_amount_krw)::integer as reserved_refund_krw
      from shorts_mvp.subscription_upgrade_refunds
      where status in ('pending','submitted','manual_review')
      group by source_order_id
    ) ur on ur.source_order_id=o.id
    left join lateral (
      select max(a.created_at) as last_allocated_at
      from shorts_mvp.usage_grants g
      join shorts_mvp.usage_grant_allocations a on a.grant_id=g.id
      where g.billing_order_id=o.id and g.kind='base'
        and a.status in ('reserved','consumed')
    ) bua on true
    left join lateral (
      select count(*)::integer as usage_count,max(occurred_at) as last_used_at
      from shorts_mvp.popular_filter_usage_events
      where billing_order_id=o.id
    ) pfu on true
    left join lateral (
      select max(last_downloaded_at) as last_downloaded_at
      from shorts_mvp.ebook_download_counters
      where user_id=o.user_id
        and last_downloaded_at >= coalesce(o.renewal_period_start,o.approved_at)
    ) ebook on true
    left join lateral (
      select j.completed_at
      from shorts_mvp.usage_grants g
      join shorts_mvp.usage_grant_allocations a
        on a.grant_id=g.id and a.status='consumed'
      join shorts_mvp.usage_reservations ur
        on ur.id=a.reservation_id and ur.status='consumed'
      join shorts_mvp.video_jobs j
        on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
      where g.billing_order_id=o.id
      order by j.completed_at,j.created_at,j.id
      limit 1
    ) first_job on true
    where (${filters.status}='all' or o.status=${filters.status})
      and (${filters.provider}='all' or o.provider=${filters.provider})
      and (
        ${filters.query}=''
        or lower(coalesce(u.email,'')) like ${`%${filters.query.toLowerCase()}%`}
        or lower(o.order_id) like ${`%${filters.query.toLowerCase()}%`}
        or lower(coalesce(o.provider_transaction_id,'')) like ${`%${filters.query.toLowerCase()}%`}
      )
    order by o.created_at desc,o.id desc
    limit ${ADMIN_BILLING_ORDER_PAGE_SIZE + 1}
    offset ${offset}
  `;
  const hasMore = rows.length > ADMIN_BILLING_ORDER_PAGE_SIZE;
  const orders = rows
    .slice(0, ADMIN_BILLING_ORDER_PAGE_SIZE)
    .map((row) => toAdminOrder(row));

  return {
    orders,
    hasMore,
    nextOffset: offset + orders.length,
  };
}
