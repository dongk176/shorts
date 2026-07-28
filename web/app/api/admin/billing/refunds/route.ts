import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { syncCachedPlan } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  adminRefundReasonCodes,
  adminRefundReasonLabel,
  getPrepaidPackageMonthState,
  quoteFirstCompletedJobRefund,
} from "@/lib/refund-policy";
import {
  assertThePayOneBillingEnabled,
  createPaymentTrackId,
  refundThePayOnePayment,
  thePayOneRefundMismatchFields,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  orderId: z.string().uuid(),
  amountKrw: z.number().int().positive().max(100_000_000),
  reasonCode: z.enum(adminRefundReasonCodes),
  reason: z.string().trim().min(2).max(400),
}).strict();

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
}

function kstDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function POST(request: Request) {
  let refundId: string | null = null;
  let billingOrderId: string | null = null;
  let claimed = false;
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const db = getDb();
    const prepared = await db.begin(async (tx) => {
      const existing = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where request_id=${body.requestId} limit 1
      `;
      if (existing[0]) return { refund: existing[0], order: null };

      const orders = await tx`
        select o.*,u.email,p.prepaid_months
        from shorts_mvp.billing_orders o
        join shorts_mvp.app_users u on u.id=o.user_id
        left join shorts_mvp.plans p on p.code=o.product_code
        where o.id=${body.orderId}
        for update of o
      `;
      const order = orders[0];
      if (!order) throw new HttpError(404, "환불할 주문을 찾을 수 없습니다.");
      if (
        order.status !== "succeeded"
        || order.provider !== "thepayone"
        || !order.providerTransactionId
      ) throw new HttpError(409, "더페이원 승인 완료 주문만 자동 환불할 수 있습니다.");

      const reservedRows = await tx`
        select (
          coalesce((
            select sum(amount_krw)
            from shorts_mvp.admin_billing_refunds
            where billing_order_id=${order.id}
              and status in ('pending','processing','succeeded','manual_review')
          ),0)
          + coalesce((
            select sum(refund_amount_krw)
            from shorts_mvp.subscription_upgrade_refunds
            where source_order_id=${order.id}
              and status in ('pending','submitted','completed','manual_review')
          ),0)
        )::integer as amount
      `;
      const reservedAmountKrw = Number(reservedRows[0]?.amount || 0);
      const refundable = Number(order.amountKrw) - reservedAmountKrw;
      const requestedAt = new Date();
      const contractStart = order.renewalPeriodStart instanceof Date
        ? order.renewalPeriodStart
        : order.approvedAt instanceof Date
          ? order.approvedAt
          : null;
      const prepaidMonths = order.billingCycle === "yearly"
        ? Number(order.prepaidMonths || 12)
        : 1;
      const packageMonthState = contractStart
        ? getPrepaidPackageMonthState({
          periodStart: contractStart,
          prepaidMonths,
          requestedAt,
        })
        : null;
      const firstCompletedJobRows = await tx`
        select j.id,j.completed_at
        from shorts_mvp.usage_grants g
        join shorts_mvp.usage_grant_allocations a
          on a.grant_id=g.id and a.status='consumed'
        join shorts_mvp.usage_reservations ur
          on ur.id=a.reservation_id and ur.status='consumed'
        join shorts_mvp.video_jobs j
          on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
        where g.billing_order_id=${order.id}
        order by j.completed_at,j.created_at,j.id
        limit 1
      `;
      const firstCompletedJob = firstCompletedJobRows[0] || null;
      const paidFeatureUsageRows = await tx`
        select count(*)::integer as popular_filter_usage_count,
          max(occurred_at) as popular_filter_last_used_at,
          count(*) filter (
            where ${packageMonthState?.currentMonthStart || null}::timestamptz is not null
              and occurred_at >= ${packageMonthState?.currentMonthStart || null}
              and occurred_at < ${packageMonthState?.currentMonthEnd || null}
          )::integer as current_month_popular_filter_usage_count
        from shorts_mvp.popular_filter_usage_events
        where billing_order_id=${order.id}
      `;
      const popularFilterUsageCount = Number(
        paidFeatureUsageRows[0]?.popularFilterUsageCount || 0,
      );
      const currentMonthPopularFilterUsageCount = Number(
        paidFeatureUsageRows[0]?.currentMonthPopularFilterUsageCount || 0,
      );
      const baseUsageRows = order.kind === "addon" ? [] : await tx`
        select
          coalesce(sum(consumed_seconds),0)::integer as consumed,
          coalesce(sum(reserved_seconds),0)::integer as reserved
        from shorts_mvp.usage_grants
        where billing_order_id=${order.id} and kind='base'
      `;
      const baseConsumedSeconds = Number(baseUsageRows[0]?.consumed || 0);
      const baseReservedSeconds = Number(baseUsageRows[0]?.reserved || 0);
      const currentMonthBaseUsageRows = !packageMonthState ? [] : await tx`
        select coalesce(sum(a.allocated_seconds),0)::integer as allocated
        from shorts_mvp.usage_grant_allocations a
        join shorts_mvp.usage_grants g on g.id=a.grant_id
        where g.billing_order_id=${order.id} and g.kind='base'
          and a.status in ('reserved','consumed')
          and a.created_at >= ${packageMonthState.currentMonthStart}
          and a.created_at < ${packageMonthState.currentMonthEnd}
      `;
      const currentMonthBaseAllocatedSeconds = Number(
        currentMonthBaseUsageRows[0]?.allocated || 0,
      );
      const ebookUsageRows = !contractStart || order.kind === "addon" ? [] : await tx`
        select count(*)::integer as ebook_usage_count,
          count(*) filter (
            where ${packageMonthState?.currentMonthStart || null}::timestamptz is not null
              and last_downloaded_at >= ${packageMonthState?.currentMonthStart || null}
              and last_downloaded_at < ${packageMonthState?.currentMonthEnd || null}
          )::integer as current_month_ebook_usage_count
        from shorts_mvp.ebook_download_counters
        where user_id=${order.userId} and last_downloaded_at >= ${contractStart}
      `;
      const ebookUsageCount = Number(ebookUsageRows[0]?.ebookUsageCount || 0);
      const currentMonthEbookUsageCount = Number(
        ebookUsageRows[0]?.currentMonthEbookUsageCount || 0,
      );
      const hasPaidServiceUsage = popularFilterUsageCount > 0
        || baseConsumedSeconds > 0
        || baseReservedSeconds > 0
        || ebookUsageCount > 0;
      const currentPackageMonthUsed = currentMonthPopularFilterUsageCount > 0
        || currentMonthBaseAllocatedSeconds > 0
        || currentMonthEbookUsageCount > 0;
      if (
        body.reasonCode === "statutory_withdrawal_unused"
        && order.kind !== "addon"
        && hasPaidServiceUsage
      ) {
        throw new HttpError(
          409,
          "쇼츠 생성·처리시간 또는 유료 기능 사용 이력이 있어 미사용 전액환불로 처리할 수 없습니다. 중도해지 기준을 확인해 주세요.",
          "PAID_FEATURE_ALREADY_USED",
        );
      }
      let amountKrw = body.amountKrw;
      let policyQuote = null;
      let entitlementActionMode: "none" | "revoke_now" | "end_at" = "none";
      let entitlementEffectiveAt: Date | null = null;
      if (body.reasonCode === "customer_early_termination") {
        if (order.kind === "addon") {
          throw new HttpError(409, "추가 처리시간에는 구독·패키지 환불 기준을 적용할 수 없습니다.");
        }
        policyQuote = quoteFirstCompletedJobRefund({
          actualPaymentKrw: Number(order.amountKrw),
          refundedOrReservedKrw: reservedAmountKrw,
          prepaidMonths,
          firstJobCompleted: Boolean(firstCompletedJob),
        });
        amountKrw = policyQuote.refundAmountKrw;
        if (amountKrw < 1) {
          throw new HttpError(409, "첫 작업 완료에 따른 1개월분을 공제하면 환불할 금액이 없습니다.");
        }
        if (order.subscriptionId) {
          entitlementEffectiveAt = firstCompletedJob
            ? packageMonthState?.currentMonthEnd || requestedAt
            : requestedAt;
          entitlementActionMode = entitlementEffectiveAt > requestedAt
            ? "end_at"
            : "revoke_now";
        }
      } else if (body.reasonCode !== "goodwill") {
        amountKrw = refundable;
      }
      if (
        body.reasonCode === "statutory_withdrawal_unused"
        && order.subscriptionId
      ) {
        entitlementActionMode = "revoke_now";
        entitlementEffectiveAt = requestedAt;
      }
      if (amountKrw > refundable) throw new HttpError(409, "남은 환불 가능 금액을 초과했습니다.");
      if (order.kind === "addon" && amountKrw !== refundable) {
        throw new HttpError(409, "추가 상품은 남은 결제금액 전액만 환불할 수 있습니다.");
      }
      if (
        amountKrw < refundable
        && order.approvedAt instanceof Date
        && kstDay(order.approvedAt) === kstDay(new Date())
      ) throw new HttpError(409, "당일 승인 거래는 전액 환불만 가능합니다.");

      if (order.kind === "addon") {
        const grants = await tx`
          select count(*)::integer as grant_count,
            coalesce(sum(consumed_seconds),0)::integer as consumed,
            coalesce(sum(reserved_seconds),0)::integer as reserved
          from shorts_mvp.usage_grants
          where billing_order_id=${order.id} and kind='addon'
        `;
        if (Number(grants[0]?.grantCount || 0) !== 1) {
          throw new HttpError(409, "추가 상품 권한 원장을 확인할 수 없어 자동 환불을 중단했습니다.");
        }
        if (Number(grants[0]?.consumed || 0) > 0 || Number(grants[0]?.reserved || 0) > 0) {
          throw new HttpError(409, "이미 사용하거나 처리 중인 추가 시간은 자동 환불할 수 없습니다.");
        }
      }

      const trackId = createPaymentTrackId("REFUND");
      const reason = `[${adminRefundReasonLabel(body.reasonCode)}] ${body.reason}`;
      const inserted = await tx`
        insert into shorts_mvp.admin_billing_refunds (
          request_id,billing_order_id,requested_by_user_id,provider,provider_track_id,
          root_provider_transaction_id,amount_krw,reason,status,refund_policy_version,
          policy_quote,entitlement_action_mode,entitlement_effective_at
        ) values (
          ${body.requestId},${order.id},${admin.id},'thepayone',${trackId},
          ${order.providerTransactionId},${amountKrw},${reason},'pending',
          ${3},
          ${policyQuote ? tx.json(policyQuote) : null},${entitlementActionMode},
          ${entitlementEffectiveAt}
        ) returning *
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.refund_requested','billing_order',${order.id},
          ${tx.json({
            refundId: inserted[0].id,
            amountKrw,
            reasonCode: body.reasonCode,
            reason: body.reason,
            policyQuote,
            refundPolicyVersion: 3,
            firstCompletedJobId: firstCompletedJob?.id || null,
            firstCompletedJobAt: firstCompletedJob?.completedAt || null,
            entitlementActionMode,
            entitlementEffectiveAt,
            popularFilterUsageCount,
            popularFilterLastUsedAt:
              paidFeatureUsageRows[0]?.popularFilterLastUsedAt || null,
            baseConsumedSeconds,
            baseReservedSeconds,
            ebookUsageCount,
            currentMonthBaseAllocatedSeconds,
            currentPackageMonthUsed,
          })}
        )
      `;
      return { refund: inserted[0], order };
    });

    const refund = prepared.refund;
    refundId = refund.id;
    billingOrderId = refund.billingOrderId;
    if (refund.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        refundId: refund.id,
        alreadyProcessed: true,
        entitlementActionStatus: refund.entitlementActionStatus,
      });
    }
    if (refund.status !== "pending") {
      throw new HttpError(409, "이미 처리 중이거나 확인이 필요한 환불 요청입니다.");
    }
    const order = prepared.order || (await db`
      select * from shorts_mvp.billing_orders where id=${refund.billingOrderId} limit 1
    `)[0];
    if (!order) throw new HttpError(404, "환불할 원주문을 찾을 수 없습니다.");

    const claim = await db`
      update shorts_mvp.admin_billing_refunds set status='processing'
      where id=${refund.id} and status='pending' returning id
    `;
    if (!claim[0]) throw new HttpError(409, "다른 요청에서 환불을 처리하고 있습니다.");
    claimed = true;

    const providerRefund = await refundThePayOnePayment({
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      referenceId: refund.id,
      reason: refund.reason,
    });
    const refundMismatchFields = thePayOneRefundMismatchFields(providerRefund, {
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      terminalId: thePayOneTerminalId(),
    });
    if (refundMismatchFields.length > 0) {
      throw new ThePayOneError(
        "환불 승인 결과가 원주문과 일치하지 않습니다.",
        "REFUND_MISMATCH",
        `불일치 필드: ${refundMismatchFields.join(",")}`,
        true,
      );
    }

    const reconciliation = await db.begin(async (tx) => {
      const locked = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where id=${refund.id} for update
      `;
      if (!locked[0] || locked[0].status !== "processing") {
        throw new Error("REFUND_STATE_CHANGED");
      }
      const lockedOrders = await tx`
        select * from shorts_mvp.billing_orders where id=${order.id} for update
      `;
      if (!lockedOrders[0]) throw new Error("REFUND_ORDER_MISSING");
      const newRefundedAmount = Number(lockedOrders[0].refundedAmountKrw || 0) + Number(refund.amountKrw);
      const fullyRefunded = newRefundedAmount === Number(order.amountKrw);
      let entitlementStatus = order.kind === "addon" ? "revoked" : "manual_review";
      if (order.kind === "addon") await tx`
        update shorts_mvp.usage_grants set status='revoked'
        where billing_order_id=${order.id} and kind='addon'
          and consumed_seconds=0 and reserved_seconds=0
      `;
      if (
        order.kind !== "addon"
        && order.subscriptionId
        && locked[0].entitlementActionMode !== "none"
        && locked[0].entitlementEffectiveAt instanceof Date
      ) {
        const subscriptions = await tx`
          select * from shorts_mvp.user_subscriptions
          where id=${order.subscriptionId} for update
        `;
        const subscription = subscriptions[0];
        if (!subscription) {
          entitlementStatus = "manual_review";
        } else if (locked[0].entitlementActionMode === "revoke_now") {
          await tx`
            update shorts_mvp.user_subscriptions
            set status='expired',current_period_end=least(current_period_end,clock_timestamp()),
              next_charge_at=null,next_quota_at=null,next_retry_at=null,grace_ends_at=null,
              cancel_at_period_end=false,canceled_at=clock_timestamp(),ended_at=clock_timestamp()
            where id=${subscription.id}
          `;
          await tx`
            update shorts_mvp.usage_grants
            set status='revoked',updated_at=clock_timestamp()
            where subscription_id=${subscription.id} and kind='base' and status='active'
          `;
          const activeRows = await tx`
            select s.plan_code
            from shorts_mvp.user_subscriptions s
            join shorts_mvp.plans p on p.code=s.plan_code
            where s.user_id=${order.userId} and s.status='active'
              and s.current_period_start <= clock_timestamp()
              and s.current_period_end > clock_timestamp()
            order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc
            limit 1
          `;
          await syncCachedPlan(tx, String(order.userId), activeRows[0]?.planCode || "free");
          entitlementStatus = "revoked";
        } else if (
          locked[0].entitlementActionMode === "end_at"
          && locked[0].entitlementEffectiveAt > new Date()
        ) {
          const entitlementEndsAt = locked[0].entitlementEffectiveAt;
          await tx`
            update shorts_mvp.user_subscriptions
            set current_period_end=least(current_period_end,${entitlementEndsAt}),
              next_charge_at=null,next_quota_at=null,next_retry_at=null,grace_ends_at=null,
              cancel_at_period_end=true,canceled_at=clock_timestamp()
            where id=${subscription.id} and status='active'
          `;
          await tx`
            update shorts_mvp.usage_grants
            set status='revoked',updated_at=clock_timestamp()
            where subscription_id=${subscription.id} and kind='base' and status='active'
              and valid_from >= ${entitlementEndsAt}
          `;
          await tx`
            update shorts_mvp.usage_grants
            set expires_at=${entitlementEndsAt},updated_at=clock_timestamp()
            where subscription_id=${subscription.id} and kind='base' and status='active'
              and valid_from < ${entitlementEndsAt} and expires_at > ${entitlementEndsAt}
          `;
          entitlementStatus = "scheduled_end";
        } else {
          entitlementStatus = "manual_review";
        }
      }
      await tx`
        update shorts_mvp.billing_orders
        set refunded_amount_krw=${newRefundedAmount},
          refund_status=${fullyRefunded ? "full" : "partial"}
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.admin_billing_refunds
        set status='succeeded',provider_refund_transaction_id=${providerRefund.providerTransactionId},
          provider_code=${providerRefund.resultCode},entitlement_action_status=${entitlementStatus},
          failure_message=null,processed_at=${providerRefund.refundedAt}
        where id=${refund.id}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},validation_status='processed',
          processing_result='admin_refund_reconciled',processed_at=now()
        where provider='thepayone'
          and provider_transaction_id=${providerRefund.providerTransactionId}
          and validation_status in ('received','validated')
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.refund_succeeded','billing_refund',${refund.id},
          ${tx.json({
            orderId: order.id,
            amountKrw: Number(refund.amountKrw),
            fullyRefunded,
            entitlementStatus,
            entitlementActionMode: locked[0].entitlementActionMode,
            entitlementEffectiveAt: locked[0].entitlementEffectiveAt,
          })}
        )
      `;
      return { entitlementStatus };
    });
    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      amountKrw: Number(refund.amountKrw),
      entitlementRequiresReview: reconciliation.entitlementStatus === "manual_review",
      entitlementActionStatus: reconciliation.entitlementStatus,
    });
  } catch (error) {
    if (refundId && claimed) {
      const unknown = error instanceof ThePayOneError && error.outcomeUnknown;
      try {
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.admin_billing_refunds
            set status=${unknown ? "manual_review" : "failed"},
              provider_code=${error instanceof ThePayOneError ? error.resultCode : "REFUND_FAILED"},
              failure_message=${safeFailureMessage(error)},processed_at=now(),
              entitlement_action_status=${unknown ? "manual_review" : "not_required"}
            where id=${refundId} and status='processing'
          `;
          if (billingOrderId && unknown) await tx`
            update shorts_mvp.billing_orders set refund_status='manual_review'
            where id=${billingOrderId}
          `;
        });
      } catch {
        // Preserve the original provider outcome for operator reconciliation.
      }
    }
    return apiError(error, "환불을 처리하지 못했습니다.");
  }
}
