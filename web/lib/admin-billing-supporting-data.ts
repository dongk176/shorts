import "server-only";

import type {
  AdminBillingSupportingData,
  AdminRefund,
  RemediationMetrics,
} from "@/lib/admin-billing-contract";
import { getDb } from "@/lib/db";

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : value
      ? new Date(String(value)).toISOString()
      : null;
}

export async function loadAdminBillingSupportingData(): Promise<AdminBillingSupportingData> {
  const db = getDb();
  const refundRows = await db`
    select r.id,r.billing_order_id,r.amount_krw,r.reason,r.status,
      r.entitlement_action_status,r.provider_refund_transaction_id,r.failure_message,
      r.requested_at,r.processed_at,o.order_id,u.email,a.email as admin_email
    from shorts_mvp.admin_billing_refunds r
    join shorts_mvp.billing_orders o on o.id=r.billing_order_id
    join shorts_mvp.app_users u on u.id=o.user_id
    join shorts_mvp.app_users a on a.id=r.requested_by_user_id
    where ${true}::boolean
    order by r.requested_at desc
    limit 50
  `;
  const remediationMetricRows = await db`
    select
      count(*)::integer as total,
      count(*) filter (where r.state='required')::integer as required,
      count(*) filter (where r.state='registering')::integer as registering,
      count(*) filter (where r.state='awaiting_provider')::integer as awaiting_provider,
      count(*) filter (where r.state='completed')::integer as completed,
      count(*) filter (where r.state='expired')::integer as expired,
      count(*) filter (where r.state='manual_review')::integer as manual_review,
      count(*) filter (
        where r.state='registering'
          and r.claim_started_at<clock_timestamp()-interval '2 minutes'
      )::integer as stale_registering,
      count(*) filter (
        where r.state in ('required','registering','awaiting_provider')
          and (
            s.current_period_end<>r.original_current_period_end
            or s.next_charge_at<>r.original_next_charge_at
            or s.billing_anchor_day<>r.billing_anchor_day
          )
      )::integer as snapshot_changed,
      count(*) filter (
        where legacy.provider_schedule_status='active'
          and replacement.provider_schedule_status='active'
      )::integer as duplicate_active_schedules,
      coalesce((
        select enabled from shorts_mvp.runtime_feature_flags
        where flag_key='legacy_recurring_card_claims'
      ),false) as claims_enabled,
      coalesce((
        select enabled from shorts_mvp.runtime_feature_flags
        where flag_key='legacy_recurring_card_reconciliation'
      ),false) as reconciliation_enabled
    from shorts_mvp.billing_payment_method_remediations r
    join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
    join shorts_mvp.billing_payment_methods legacy on legacy.id=r.legacy_payment_method_id
    left join shorts_mvp.billing_payment_methods replacement on replacement.id=r.new_payment_method_id
    where r.campaign_key='legacy_easycut_pro_202608'
      and ${true}::boolean
  `;
  const refunds: AdminRefund[] = refundRows.map((row) => ({
    id: String(row.id),
    billingOrderId: String(row.billingOrderId),
    orderId: String(row.orderId),
    email: String(row.email || "-"),
    adminEmail: String(row.adminEmail || "-"),
    amountKrw: Number(row.amountKrw || 0),
    reason: String(row.reason || ""),
    status: String(row.status || ""),
    entitlementActionStatus: String(row.entitlementActionStatus || ""),
    providerRefundTransactionId: row.providerRefundTransactionId
      ? String(row.providerRefundTransactionId)
      : null,
    failureMessage: row.failureMessage ? String(row.failureMessage) : null,
    requestedAt: iso(row.requestedAt)!,
    processedAt: iso(row.processedAt),
  }));
  const row = remediationMetricRows[0];
  const remediationMetrics: RemediationMetrics | null = row ? {
    total: Number(row.total || 0),
    required: Number(row.required || 0),
    registering: Number(row.registering || 0),
    awaitingProvider: Number(row.awaitingProvider || 0),
    completed: Number(row.completed || 0),
    expired: Number(row.expired || 0),
    manualReview: Number(row.manualReview || 0),
    staleRegistering: Number(row.staleRegistering || 0),
    snapshotChanged: Number(row.snapshotChanged || 0),
    duplicateActiveSchedules: Number(row.duplicateActiveSchedules || 0),
    claimsEnabled: Boolean(row.claimsEnabled),
    reconciliationEnabled: Boolean(row.reconciliationEnabled),
  } : null;
  return { refunds, remediationMetrics };
}
