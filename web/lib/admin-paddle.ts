import "server-only";
import { getDb } from "@/lib/db";
import type { AdminOrder } from "@/lib/admin-billing-contract";
import type { PaddleSalesTotal } from "@/lib/admin-paddle-contract";
import { kstDate, shiftTrendDate } from "@/lib/admin-trends";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";

// Only observed, completed live payments. Neither opening a checkout nor a
// sandbox transaction is revenue. Use the payment snapshot, not today's plan.
export async function loadAdminPaddleOrders(ids: string[]): Promise<AdminOrder[]> {
  const db = getDb();
  const rows = await db`
    select p.*,u.email,s.status as subscription_status,
      coalesce(p.plan_code,g.product_code,'unknown') as purchased_plan,
      coalesce(a.refunded,0) as refunded,coalesce(a.pending,0) as pending,
      coalesce(a.chargeback,0) as chargeback
    from shorts_mvp.paddle_payments p
    join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.user_id=p.user_id
    join shorts_mvp.app_users u on u.id=p.user_id
    left join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id
    left join shorts_mvp.usage_grants g on g.id=p.grant_id
    left join lateral (
      select sum(amount_minor) filter(where action='refund' and status='approved') as refunded,
        sum(amount_minor) filter(where action='refund' and status='pending_approval') as pending,
        sum(amount_minor) filter(where action='chargeback' and status='approved') as chargeback
      from shorts_mvp.paddle_adjustments where transaction_id=p.transaction_id
    ) a on true
    where ps.environment='live' and p.transaction_id=any(${ids}::text[])
  `;
  const iso = (value: unknown) => new Date(value as string).toISOString();
  return rows.map((r) => {
    const amount = Number(r.amountMinor);
    const refunded = Math.min(amount, Number(r.refunded));
    const code = String(r.purchasedPlan);
    const months = Number(/_(3|6|12)m$/.exec(code)?.[1] || 1);
    return {
      id: String(r.transactionId), orderId: String(r.transactionId), kind: "구독",
      productCode: code, billingCycle: `${months}개월 자동결제`, prepaidMonths: months,
      refundPolicyVersion: 0, amountKrw: 0, refundedAmountKrw: 0, reservedRefundKrw: 0,
      currency: r.currency as "USD" | "JPY", amountMinor: amount, refundedAmountMinor: refunded,
      pendingRefundMinor: Number(r.pending), chargebackMinor: Number(r.chargeback),
      paddleSubscriptionId: String(r.paddleSubscriptionId),
      refundStatus: refunded >= amount ? "full" : refunded > 0 ? "partial" : "none",
      status: "succeeded", provider: "paddle", providerTransactionId: String(r.transactionId),
      providerStatus: "completed", providerTerminalId: null, hasPaymentMethod: false,
      credentialScope: null, installmentMonths: 0, cardIssuerName: null, installmentBenefitType: null,
      declaredCardKind: null, failureCode: null, failureMessage: null,
      // This ledger records webhook processing time, not the card capture time.
      approvedAt: null, createdAt: iso(r.createdAt), email: String(r.email || "-"),
      subscriptionStatus: r.subscriptionStatus ? String(r.subscriptionStatus) : null,
      contractPeriodStart: iso(r.periodStart), contractPeriodEnd: iso(r.periodEnd),
      currentPackageMonthUsed: false, firstCompletedJobAt: null,
      popularFilterUsageCount: 0, popularFilterLastUsedAt: null,
    };
  });
}

export async function loadAdminPaddleSales(today = kstDate()): Promise<PaddleSalesTotal[]> {
  const db = getDb();
  const rows = await db`
    with paid as (
      select p.currency,p.amount_minor,p.created_at,
        least(p.amount_minor,coalesce(a.refunded,0)) as refunded,
        least(greatest(0,p.amount_minor-coalesce(a.refunded,0)),coalesce(a.chargeback,0)) as chargeback,
        coalesce(a.pending,0) as pending
      from shorts_mvp.paddle_payments p
      join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.user_id=p.user_id
      left join lateral (
        select sum(amount_minor) filter(where action='refund' and status='approved') as refunded,
          sum(amount_minor) filter(where action='chargeback' and status='approved') as chargeback,
          sum(amount_minor) filter(where action='refund' and status='pending_approval') as pending
        from shorts_mvp.paddle_adjustments where transaction_id=p.transaction_id
      ) a on true
      where ps.environment='live'
      ${oneTimeEnabled()?db`union all select currency,amount_minor,paid_at,refunded_minor,
        case when reversed then greatest(0,amount_minor-refunded_minor) else 0 end,0
        from shorts_mvp.paypal_one_time_orders where environment='live' and status='completed'`:db``}
    )
    select currency,sum(amount_minor) as gross,sum(refunded) as refunded,sum(chargeback) as chargeback,
      sum(pending) as pending,count(*) as paid_orders,
      coalesce(sum(amount_minor) filter(where created_at >= ${today + "T00:00:00+09:00"}::timestamptz
        and created_at < ${shiftTrendDate(today, 1) + "T00:00:00+09:00"}::timestamptz),0) as today_gross,
      count(*) filter(where created_at >= ${today + "T00:00:00+09:00"}::timestamptz
        and created_at < ${shiftTrendDate(today, 1) + "T00:00:00+09:00"}::timestamptz) as today_paid_orders
    from paid group by currency order by currency
  `;
  return (["USD", "JPY"] as const).map((currency) => {
    const r = rows.find((row) => row.currency === currency);
    const grossMinor = Number(r?.gross || 0), refundedMinor = Number(r?.refunded || 0), chargebackMinor = Number(r?.chargeback || 0);
    return { currency, grossMinor, refundedMinor, chargebackMinor, netMinor: grossMinor - refundedMinor - chargebackMinor,
      pendingRefundMinor: Number(r?.pending || 0), paidOrders: Number(r?.paidOrders || 0),
      todayGrossMinor: Number(r?.todayGross || 0), todayPaidOrders: Number(r?.todayPaidOrders || 0) };
  });
}
