import "server-only";

import { z } from "zod";
import { addKstMonths } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getPrepaidPackageMonthState } from "@/lib/refund-policy";
import type { AdminBillingOrderPage, AdminOrder } from "@/lib/admin-billing-contract";

export const ADMIN_BILLING_ORDER_PAGE_SIZE = 20;

export type AdminBillingOrderFilters = {
  status: string;
  provider: string;
  query: string;
};

const billingOrderCursorSchema = z.object({
  v: z.literal(1),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  filters: z.object({
    status: z.string(),
    provider: z.string(),
    query: z.string(),
  }),
});

type BillingOrderCursor = z.infer<typeof billingOrderCursorSchema>;

function encodeBillingOrderCursor(cursor: BillingOrderCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBillingOrderCursor(
  value: string | null | undefined,
  filters: AdminBillingOrderFilters,
): BillingOrderCursor | null {
  if (!value) return null;
  try {
    const cursor = billingOrderCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (
      cursor.filters.status !== filters.status
      || cursor.filters.provider !== filters.provider
      || cursor.filters.query !== filters.query
    ) {
      throw new Error("filters changed");
    }
    return cursor;
  } catch {
    throw new HttpError(400, "결제 주문 목록 위치가 올바르지 않습니다.", "INVALID_BILLING_CURSOR");
  }
}

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
    failureMessage: row.failureMessage ? String(row.failureMessage) : null,
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
  cursor: encodedCursor,
  offset = 0,
}: {
  filters: AdminBillingOrderFilters;
  cursor?: string | null;
  offset?: number;
}): Promise<AdminBillingOrderPage> {
  const db = getDb();
  const cursor = decodeBillingOrderCursor(encodedCursor, filters);
  const legacyOffset = cursor ? 0 : offset;
  const rows = await db`
    with selected_orders as materialized (
      select o.id,o.created_at
      from shorts_mvp.billing_orders o
      join shorts_mvp.app_users u on u.id=o.user_id
      where (${filters.status}='all' or o.status=${filters.status})
        and (${filters.provider}='all' or o.provider=${filters.provider})
        and (
          ${filters.query}=''
          or lower(coalesce(u.email,'')) like ${`%${filters.query.toLowerCase()}%`}
          or lower(o.order_id) like ${`%${filters.query.toLowerCase()}%`}
          or lower(coalesce(o.provider_transaction_id,'')) like ${`%${filters.query.toLowerCase()}%`}
        )
        and (
          ${cursor === null}
          or (o.created_at,o.id) < (
            ${cursor?.createdAt ?? null}::timestamptz,
            ${cursor?.id ?? null}::uuid
          )
        )
      order by o.created_at desc,o.id desc
      limit ${ADMIN_BILLING_ORDER_PAGE_SIZE + 1}
      offset ${legacyOffset}
    )
    select o.id,o.order_id,o.kind,o.product_code,o.billing_cycle,o.amount_krw,
      o.refunded_amount_krw,o.refund_status,o.status,o.provider,o.provider_transaction_id,
      o.provider_status,o.failure_code,o.failure_message,o.provider_terminal_id,o.installment_months,
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
    from selected_orders selected
    join shorts_mvp.billing_orders o on o.id=selected.id
    join shorts_mvp.app_users u on u.id=o.user_id
    left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
    left join shorts_mvp.plans p on p.code=o.product_code
    left join shorts_mvp.billing_payment_methods pm on pm.id=o.payment_method_id
    left join lateral (
      select sum(refund_amount_krw)::integer as reserved_refund_krw
      from shorts_mvp.subscription_upgrade_refunds
      where source_order_id=o.id
        and status in ('pending','submitted','manual_review')
    ) ur on true
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
    order by o.created_at desc,o.id desc
  `;
  const hasMore = rows.length > ADMIN_BILLING_ORDER_PAGE_SIZE;
  const orders = rows
    .slice(0, ADMIN_BILLING_ORDER_PAGE_SIZE)
    .map((row) => toAdminOrder(row));

  return {
    orders,
    hasMore,
    nextCursor: hasMore && orders.length
      ? encodeBillingOrderCursor({
          v: 1,
          createdAt: orders[orders.length - 1].createdAt,
          id: orders[orders.length - 1].id,
          filters,
        })
      : null,
    nextOffset: legacyOffset + orders.length,
  };
}
