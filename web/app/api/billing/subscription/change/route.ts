import { NextResponse } from "next/server";
import { z } from "zod";
import {
  billingCycles,
  paidPlanCodes,
  type BillingCycle,
  type PaidPlanCode,
} from "@/lib/contracts";
import {
  addKstMonths,
  assertPricingV2PackagePurchaseAvailable,
  getPaidPlan,
  type PaidPlanProduct,
} from "@/lib/billing";
import {
  classifySubscriptionChange,
  quoteSubscriptionChange,
} from "@/lib/billing-change";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { getActiveInstallmentOffer } from "@/lib/installments";
import { getPricingV2Plan } from "@/lib/pricing-v2";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  planCode: z.enum(paidPlanCodes),
  billingCycle: z.enum(billingCycles),
});

type SubscriptionRow = Record<string, unknown> & {
  id: string;
  userId: string;
  status: "active" | "past_due";
  planCode: PaidPlanCode;
  billingCycle: BillingCycle;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  paymentMethodId: string | null;
  paymentProvider: string | null;
  providerScheduleStatus: string;
  cancelAtPeriodEnd: boolean;
  scheduledPlanCode: PaidPlanCode | null;
  scheduledBillingCycle: BillingCycle | null;
};

function safeQuote(
  quote: ReturnType<typeof quoteSubscriptionChange>,
  currentPlanDisplayName?: string | null,
  newPlanGrantSeconds = 0,
  carryoverSeconds = 0,
  installment?: { campaignId: string | null; selectableMonths: number[] } | null,
) {
  return {
    action: quote.action,
    chargeAmountKrw: quote.chargeAmountKrw,
    providerChargeAmountKrw: quote.providerChargeAmountKrw,
    prorationCreditKrw: quote.prorationCreditKrw,
    fullCurrentPaymentRefund: quote.fullCurrentPaymentRefund,
    refund: {
      mode: quote.refundMode,
      amountKrw: quote.refundAmountKrw,
      processingBusinessDays: quote.refundMode === "manual_partial" ? 3 : 0,
      totalPeriodDays: quote.refundTotalPeriodDays,
      unusedPeriodDays: quote.refundUnusedPeriodDays,
    },
    usageGrant: {
      newPlanSeconds: newPlanGrantSeconds,
      carryoverSeconds,
      totalSeconds: newPlanGrantSeconds + carryoverSeconds,
    },
    installmentCampaignId: installment?.campaignId || null,
    selectableInstallmentMonths: installment?.selectableMonths || [],
    currentPlanDisplayName: currentPlanDisplayName || null,
    effectiveAt: quote.effectiveAt.toISOString(),
    nextChargeAt: quote.nextChargeAt.toISOString(),
  };
}

function buildQuote(
  subscription: SubscriptionRow,
  currentPlan: PaidPlanProduct,
  targetPlan: PaidPlanProduct,
  targetBillingCycle: BillingCycle,
  now: Date,
  sourcePayment?: { amountKrw: number; approvedAt: Date } | null,
) {
  return quoteSubscriptionChange({
    currentPlanCode: subscription.planCode,
    currentBillingCycle: subscription.billingCycle,
    currentPlan,
    targetPlanCode: targetPlan.code,
    targetBillingCycle,
    targetPlan,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    now,
    monthlyPeriodEnd: addKstMonths(now, 1),
    annualPeriodEnd: addKstMonths(now, targetPlan.prepaidMonths),
    sourcePaymentAmountKrw: sourcePayment?.amountKrw,
    sourcePaymentApprovedAt: sourcePayment?.approvedAt,
  });
}

async function currentSubscription(userId: string) {
  const rows = await getDb()`
    select * from shorts_mvp.user_subscriptions
    where user_id=${userId} and status in ('active','past_due')
    order by created_at desc limit 1
  `;
  return (rows[0] || null) as SubscriptionRow | null;
}

async function currentMonthlyPayment(
  userId: string,
  subscription: SubscriptionRow,
) {
  if (subscription.billingCycle !== "monthly") return null;
  const rows = await getDb()`
    select amount_krw,approved_at
    from shorts_mvp.billing_orders
    where user_id=${userId} and subscription_id=${subscription.id}
      and status='succeeded' and amount_krw > 0
      and billing_cycle='monthly'
      and kind in ('subscription_initial','subscription_renewal','subscription_change')
    order by approved_at desc nulls last,created_at desc
    limit 1
  `;
  const row = rows[0] as { amountKrw?: number; approvedAt?: Date } | undefined;
  return row?.approvedAt
    ? { amountKrw: Number(row.amountKrw || 0), approvedAt: row.approvedAt }
    : null;
}

async function currentBaseCarryoverSeconds(subscription: SubscriptionRow, now: Date) {
  const rows = await getDb()`
    select coalesce(sum(greatest(0,total_seconds-consumed_seconds)),0)::bigint as carryover_seconds
    from shorts_mvp.usage_grants
    where subscription_id=${subscription.id} and kind='base' and status='active'
      and valid_from <= ${now} and expires_at > ${now}
  `;
  return Number(rows[0]?.carryoverSeconds || 0);
}

async function applyScheduledChange(
  subscription: SubscriptionRow,
  userId: string,
  scheduledPlanCode: PaidPlanCode | null,
  scheduledBillingCycle: BillingCycle | null,
) {
  const db = getDb();
  if (subscription.billingCycle !== "monthly") {
    const updated = await db`
      update shorts_mvp.user_subscriptions
      set scheduled_plan_code=${scheduledPlanCode},
          scheduled_billing_cycle=${scheduledBillingCycle}
      where id=${subscription.id} and user_id=${userId} and status='active'
      returning id
    `;
    if (!updated[0]) throw new HttpError(409, "구독 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    return;
  }
  if (subscription.paymentProvider !== "thepayone" || !subscription.paymentMethodId) {
    throw new HttpError(409, "더페이원 자동결제 카드를 확인할 수 없습니다.");
  }
  const shouldResume = scheduledPlanCode === null;
  const expectedStatus = shouldResume ? "paused" : "active";
  const nextStatus = shouldResume ? "active" : "paused";
  if (subscription.providerScheduleStatus !== expectedStatus) {
    if (!shouldResume && subscription.providerScheduleStatus === "paused") {
      const updated = await db`
        update shorts_mvp.user_subscriptions
        set scheduled_plan_code=${scheduledPlanCode},
            scheduled_billing_cycle=${scheduledBillingCycle}
        where id=${subscription.id} and user_id=${userId} and status='active'
          and provider_schedule_status='paused'
        returning id
      `;
      if (!updated[0]) throw new HttpError(409, "구독 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    throw new HttpError(
      409,
      subscription.providerScheduleStatus === "manual_review"
        ? "자동결제 상태 확인이 필요합니다. 고객센터로 문의해 주세요."
        : "자동결제 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
    );
  }

  let cardId: string | null = null;
  let paymentMethodId: string | null = null;
  try {
    await db.begin(async (tx) => {
      const liveRows = await tx`
        select * from shorts_mvp.user_subscriptions
        where id=${subscription.id} and user_id=${userId} and status='active'
          and provider_schedule_status=${expectedStatus}
        for update
      `;
      if (!liveRows[0]) {
        throw new HttpError(409, "구독 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      }
      const methods = await tx`
        select * from shorts_mvp.billing_payment_methods
        where id=${subscription.paymentMethodId} and user_id=${userId}
          and provider='thepayone' for update
      `;
      const method = methods[0];
      if (!method?.billingKeyCiphertext || !method.billingKeyIv || !method.billingKeyTag) {
        throw new HttpError(409, "더페이원 자동결제 카드를 확인할 수 없습니다.");
      }
      paymentMethodId = method.id;
      cardId = decryptCardToken({
        ciphertext: method.billingKeyCiphertext,
        iv: method.billingKeyIv,
        tag: method.billingKeyTag,
      }, method.id);
      await changeThePayOneCardStatus(
        cardId,
        shouldResume ? "사용" : "중지",
        createPaymentTrackId("AUDT"),
      );
      await tx`
        update shorts_mvp.user_subscriptions
        set provider_schedule_status=${nextStatus},
            billing_review_status='clear',billing_review_reason=null,
            scheduled_plan_code=${scheduledPlanCode},
            scheduled_billing_cycle=${scheduledBillingCycle}
        where id=${subscription.id}
      `;
      await tx`
        update shorts_mvp.billing_payment_methods
        set provider_schedule_status=${nextStatus},status=${nextStatus}
        where id=${method.id}
      `;
    });
  } catch (error) {
    if (cardId) {
      await changeThePayOneCardStatus(
        cardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).catch(() => undefined);
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.user_subscriptions
          set provider_schedule_status='manual_review',
              billing_review_status='manual_review',
              billing_review_reason='SCHEDULE_CHANGE_FAILED'
          where id=${subscription.id} and user_id=${userId} and status='active'
        `;
        if (paymentMethodId) await tx`
          update shorts_mvp.billing_payment_methods
          set provider_schedule_status='manual_review',status='manual_review'
          where id=${paymentMethodId} and user_id=${userId}
        `;
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    assertThePayOneBillingEnabled();
    const url = new URL(request.url);
    const input = schema.parse({
      planCode: url.searchParams.get("planCode"),
      billingCycle: url.searchParams.get("billingCycle"),
    });
    const session = await requireAuthenticatedMvpSession();
    const subscription = await currentSubscription(session.userId);
    if (!subscription) throw new HttpError(404, "변경할 구독을 찾을 수 없습니다.");
    if (
      subscription.scheduledPlanCode
      && (subscription.scheduledPlanCode !== input.planCode
        || subscription.scheduledBillingCycle !== input.billingCycle)
      && (subscription.status === "past_due" || subscription.currentPeriodEnd <= new Date())
    ) {
      throw new HttpError(409, "예약된 플랜과 결제 요청이 일치하지 않습니다.");
    }
    const db = getDb();
    const [currentPlan, targetPlan] = await Promise.all([
      getPaidPlan(db, subscription.planCode),
      getPaidPlan(db, input.planCode),
    ]);
    const pricingV2Target = getPricingV2Plan(targetPlan.code);
    if (pricingV2Target && pricingV2Target.billingCycle !== input.billingCycle) {
      throw new HttpError(409, "선택한 상품의 결제 방식이 올바르지 않습니다.");
    }
    const now = new Date();
    if (subscription.status === "past_due" || subscription.currentPeriodEnd <= now) {
      const chargeAmountKrw = input.billingCycle === "yearly"
        ? targetPlan.yearlyPriceKrw
        : targetPlan.monthlyPriceKrw;
      const installment = input.billingCycle === "yearly"
        ? await getActiveInstallmentOffer(db, { amountKrw: chargeAmountKrw })
        : null;
      return NextResponse.json({
        action: "renewal",
        chargeAmountKrw,
        providerChargeAmountKrw: chargeAmountKrw,
        prorationCreditKrw: 0,
        fullCurrentPaymentRefund: false,
        refund: {
          mode: "none",
          amountKrw: 0,
          processingBusinessDays: 0,
          totalPeriodDays: 0,
          unusedPeriodDays: 0,
        },
        usageGrant: {
          newPlanSeconds: targetPlan.monthlySourceSeconds,
          carryoverSeconds: 0,
          totalSeconds: targetPlan.monthlySourceSeconds,
        },
        installmentCampaignId: installment?.campaignId || null,
        selectableInstallmentMonths: installment?.selectableMonths || [],
        effectiveAt: now.toISOString(),
        nextChargeAt: addKstMonths(
          now,
          input.billingCycle === "yearly" ? targetPlan.prepaidMonths : 1,
        ).toISOString(),
      });
    }
    const [sourcePayment, carryoverSeconds] = await Promise.all([
      currentMonthlyPayment(session.userId, subscription),
      currentBaseCarryoverSeconds(subscription, now),
    ]);
    const quote = buildQuote(
        subscription,
        currentPlan,
        targetPlan,
        input.billingCycle,
        now,
        sourcePayment,
      );
    const installment = input.billingCycle === "yearly"
      ? await getActiveInstallmentOffer(db, { amountKrw: quote.chargeAmountKrw })
      : null;
    return NextResponse.json(safeQuote(
      quote,
      currentPlan.displayName,
      targetPlan.monthlySourceSeconds,
      carryoverSeconds,
      installment,
    ));
  } catch (error) {
    return apiError(error, "구독 변경 금액을 계산하지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const subscription = await currentSubscription(session.userId);
    if (!subscription) throw new HttpError(404, "변경할 구독을 찾을 수 없습니다.");
    await assertPricingV2PackagePurchaseAvailable(db, session.userId, body.planCode);
    const [currentPlan, targetPlan] = await Promise.all([
      getPaidPlan(db, subscription.planCode),
      getPaidPlan(db, body.planCode),
    ]);
    const pricingV2Target = getPricingV2Plan(targetPlan.code);
    if (pricingV2Target && pricingV2Target.billingCycle !== body.billingCycle) {
      throw new HttpError(409, "선택한 상품의 결제 방식이 올바르지 않습니다.");
    }
    const now = new Date();
    if (subscription.status === "past_due" || subscription.currentPeriodEnd <= now) {
      if (
        subscription.scheduledPlanCode
        && (subscription.scheduledPlanCode !== body.planCode
          || subscription.scheduledBillingCycle !== body.billingCycle)
      ) {
        throw new HttpError(409, "예약된 플랜과 결제 요청이 일치하지 않습니다.");
      }
      const chargeAmountKrw = body.billingCycle === "yearly"
        ? targetPlan.yearlyPriceKrw
        : targetPlan.monthlyPriceKrw;
      const checkoutUrl = new URL("/billing/checkout", request.url);
      checkoutUrl.searchParams.set("mode", "change_subscription");
      checkoutUrl.searchParams.set("plan", body.planCode);
      checkoutUrl.searchParams.set("cycle", body.billingCycle);
      return NextResponse.json({
        ok: true,
        action: "checkout",
        checkoutUrl: `${checkoutUrl.pathname}${checkoutUrl.search}`,
        quote: safeQuote({
          action: "scheduled",
          chargeAmountKrw,
          providerChargeAmountKrw: chargeAmountKrw,
          prorationCreditKrw: 0,
          fullCurrentPaymentRefund: false,
          refundMode: "none",
          refundAmountKrw: 0,
          refundTotalPeriodDays: 0,
          refundUnusedPeriodDays: 0,
          startsNewBillingPeriod: true,
          effectiveAt: now,
          nextChargeAt: addKstMonths(
            now,
            body.billingCycle === "yearly" ? targetPlan.prepaidMonths : 1,
          ),
        }, null, targetPlan.monthlySourceSeconds, 0),
      });
    }
    const action = classifySubscriptionChange({
      currentPlanCode: subscription.planCode,
      currentBillingCycle: subscription.billingCycle,
      targetPlanCode: body.planCode,
      targetBillingCycle: body.billingCycle,
    });

    if (action === "immediate_proration" || action === "immediate_annual_conversion") {
      const quoteTime = new Date();
      const [sourcePayment, carryoverSeconds] = await Promise.all([
        currentMonthlyPayment(session.userId, subscription),
        currentBaseCarryoverSeconds(subscription, quoteTime),
      ]);
      const quote = buildQuote(
        subscription,
        currentPlan,
        targetPlan,
        body.billingCycle,
        quoteTime,
        sourcePayment,
      );
      const checkoutUrl = new URL("/billing/checkout", request.url);
      checkoutUrl.searchParams.set("mode", "change_subscription");
      checkoutUrl.searchParams.set("plan", body.planCode);
      checkoutUrl.searchParams.set("cycle", body.billingCycle);
      return NextResponse.json({
        ok: true,
        action: "checkout",
        checkoutUrl: `${checkoutUrl.pathname}${checkoutUrl.search}`,
        quote: safeQuote(
          quote,
          currentPlan.displayName,
          targetPlan.monthlySourceSeconds,
          carryoverSeconds,
        ),
      });
    }

    const unchanged = action === "unchanged";
    if (!unchanged && subscription.cancelAtPeriodEnd) {
      throw new HttpError(
        409,
        "플랜 변경을 예약하려면 먼저 기간 말 해지 예약을 취소해 주세요.",
        "CANCELLATION_MUST_BE_WITHDRAWN",
      );
    }
    if (!unchanged || subscription.scheduledPlanCode) {
      await applyScheduledChange(
        subscription,
        session.userId,
        unchanged ? null : body.planCode,
        unchanged ? null : body.billingCycle,
      );
    }
    return NextResponse.json({
      ok: true,
      action: unchanged ? "canceled" : "scheduled",
      scheduledPlanCode: unchanged ? null : body.planCode,
      scheduledBillingCycle: unchanged ? null : body.billingCycle,
      effectiveAt: subscription.currentPeriodEnd.toISOString(),
    });
  } catch (error) {
    return apiError(error, "구독 변경을 처리하지 못했습니다.");
  }
}
