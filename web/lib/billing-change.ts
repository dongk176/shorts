import type { BillingCycle, PaidPlanCode } from "@/lib/contracts";
import {
  isEasycutProPackageReplacement,
  isPricingV2PackageCode,
} from "@/lib/pricing-v2";

export const paidPlanRank: Record<PaidPlanCode, number> = {
  plus: 0,
  standard: 1,
  pro: 2,
  easycut_pro_v2: 0,
  starter_3m: 1,
  starter_6m: 1,
  starter_12m: 1,
  expert_3m: 2,
  expert_6m: 2,
  expert_12m: 2,
};

export type SubscriptionChangeAction =
  | "unchanged"
  | "immediate_proration"
  | "immediate_annual_conversion"
  | "scheduled";

export type SubscriptionChangeQuote = {
  action: SubscriptionChangeAction;
  chargeAmountKrw: number;
  providerChargeAmountKrw: number;
  prorationCreditKrw: number;
  fullCurrentPaymentRefund: boolean;
  refundMode: "automatic_full" | "manual_partial" | "none";
  refundAmountKrw: number;
  refundTotalPeriodDays: number;
  refundUnusedPeriodDays: number;
  startsNewBillingPeriod: boolean;
  effectiveAt: Date;
  nextChargeAt: Date;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Only monthly subscriptions have a recurring billing anchor. Prepaid package
 * purchases use the yearly billing-cycle enum for their fixed service period,
 * but they must never persist the provider's non-recurring "00" billing day.
 */
export function activatedSubscriptionBillingAnchorDay(input: {
  billingCycle: BillingCycle;
  providerBillingDay: string;
  currentBillingAnchorDay?: number | null;
  activatedAt: Date;
}) {
  if (input.billingCycle !== "monthly") return null;
  if (
    Number.isInteger(input.currentBillingAnchorDay)
    && Number(input.currentBillingAnchorDay) >= 1
    && Number(input.currentBillingAnchorDay) <= 31
  ) {
    return Number(input.currentBillingAnchorDay);
  }
  const providerBillingDay = Number(input.providerBillingDay);
  if (Number.isInteger(providerBillingDay) && providerBillingDay >= 1 && providerBillingDay <= 31) {
    return providerBillingDay;
  }
  return Math.min(
    new Date(input.activatedAt.getTime() + KST_OFFSET_MS).getUTCDate(),
    28,
  );
}

export function shouldPauseRecurringPaymentMethod(input: {
  provider?: string | null;
  providerScheduleStatus?: string | null;
}) {
  return input.provider === "thepayone"
    && ["active", "manual_review"].includes(input.providerScheduleStatus || "none");
}

type PricePair = {
  monthlyPriceKrw: number;
  yearlyPriceKrw: number;
};

/**
 * A monthly upgrade starts a new allowance, but the part of the current
 * plan's base allowance that was already used must not be granted again.
 * Add-on grants are deliberately excluded: they remain independently valid.
 */
export function monthlyUpgradeBaseGrantSeconds(input: {
  targetPlanSeconds: number;
  currentBaseUnconsumedSeconds: number;
}) {
  const targetPlanSeconds = Math.max(0, Math.floor(input.targetPlanSeconds));
  const currentBaseUnconsumedSeconds = Math.max(
    0,
    Math.floor(input.currentBaseUnconsumedSeconds),
  );
  return targetPlanSeconds + currentBaseUnconsumedSeconds;
}

/**
 * A replaced Easycut Pro payment is refunded in full, so none of its remaining
 * allowance may be carried into the newly purchased package.
 */
export function retainedUpgradeCarryoverSeconds(input: {
  replacesEasycutPro: boolean;
  currentBaseUnconsumedSeconds: number;
}) {
  const currentBaseUnconsumedSeconds = Math.max(
    0,
    Math.floor(input.currentBaseUnconsumedSeconds),
  );
  return input.replacesEasycutPro ? 0 : currentBaseUnconsumedSeconds;
}

export function classifySubscriptionChange(input: {
  currentPlanCode: PaidPlanCode;
  currentBillingCycle: BillingCycle;
  targetPlanCode: PaidPlanCode;
  targetBillingCycle: BillingCycle;
}): SubscriptionChangeAction {
  const {
    currentPlanCode,
    currentBillingCycle,
    targetPlanCode,
    targetBillingCycle,
  } = input;
  if (currentPlanCode === targetPlanCode && currentBillingCycle === targetBillingCycle) {
    return "unchanged";
  }
  // Easycut Pro is replaced immediately by a prepaid package. The package is
  // charged first and the current Pro payment is then fully refunded.
  if (isEasycutProPackageReplacement(currentPlanCode, targetPlanCode)) {
    return "immediate_annual_conversion";
  }
  // Retired monthly products still move to a prepaid package at period end.
  if (currentBillingCycle === "monthly" && isPricingV2PackageCode(targetPlanCode)) {
    return "scheduled";
  }
  const targetIsLower = paidPlanRank[targetPlanCode] < paidPlanRank[currentPlanCode];
  if (targetIsLower || (currentBillingCycle === "yearly" && targetBillingCycle === "monthly")) {
    return "scheduled";
  }
  if (currentBillingCycle === "monthly" && targetBillingCycle === "yearly") {
    return "immediate_annual_conversion";
  }
  if (
    currentBillingCycle === targetBillingCycle
    && paidPlanRank[targetPlanCode] > paidPlanRank[currentPlanCode]
  ) {
    return "immediate_proration";
  }
  return "scheduled";
}

function periodPrice(plan: PricePair, cycle: BillingCycle) {
  return cycle === "yearly" ? plan.yearlyPriceKrw : plan.monthlyPriceKrw;
}

function proratedAmount(amount: number, remainingMs: number, periodMs: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || remainingMs <= 0 || periodMs <= 0) return 0;
  return Math.max(0, Math.round(amount * Math.min(1, remainingMs / periodMs)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function kstDayNumber(value: Date) {
  const kst = new Date(value.getTime() + KST_OFFSET_MS);
  return Math.floor(Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  ) / DAY_MS);
}

export type MonthlyUpgradeRefundQuote = {
  mode: "automatic_full" | "manual_partial" | "none";
  amountKrw: number;
  totalPeriodDays: number;
  unusedPeriodDays: number;
};

export function quoteMonthlyUpgradeRefund(input: {
  sourcePaymentAmountKrw: number;
  sourcePaymentApprovedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  now: Date;
}): MonthlyUpgradeRefundQuote {
  const amount = Math.max(0, Math.floor(input.sourcePaymentAmountKrw));
  const paymentDay = kstDayNumber(input.sourcePaymentApprovedAt);
  const upgradeDay = kstDayNumber(input.now);
  const periodStartDay = kstDayNumber(input.currentPeriodStart);
  const periodEndDay = kstDayNumber(input.currentPeriodEnd);
  const totalPeriodDays = Math.max(0, periodEndDay - periodStartDay);
  if (amount <= 0 || totalPeriodDays <= 0 || upgradeDay >= periodEndDay) {
    return { mode: "none", amountKrw: 0, totalPeriodDays, unusedPeriodDays: 0 };
  }
  if (paymentDay === upgradeDay) {
    return {
      mode: "automatic_full",
      amountKrw: amount,
      totalPeriodDays,
      unusedPeriodDays: totalPeriodDays,
    };
  }
  const elapsedDaysInclusive = Math.max(1, upgradeDay - paymentDay + 1);
  const unusedPeriodDays = Math.max(0, totalPeriodDays - elapsedDaysInclusive);
  const refundAmountKrw = unusedPeriodDays > 0
    ? Math.floor(amount * unusedPeriodDays / totalPeriodDays)
    : 0;
  return {
    mode: refundAmountKrw > 0 ? "manual_partial" : "none",
    amountKrw: refundAmountKrw,
    totalPeriodDays,
    unusedPeriodDays,
  };
}

export function quoteSubscriptionChange(input: {
  currentPlanCode: PaidPlanCode;
  currentBillingCycle: BillingCycle;
  currentPlan: PricePair;
  targetPlanCode: PaidPlanCode;
  targetBillingCycle: BillingCycle;
  targetPlan: PricePair;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  now: Date;
  monthlyPeriodEnd: Date;
  annualPeriodEnd: Date;
  sourcePaymentAmountKrw?: number;
  sourcePaymentApprovedAt?: Date;
}): SubscriptionChangeQuote {
  const action = classifySubscriptionChange(input);
  if (action === "unchanged" || action === "scheduled") {
    return {
      action,
      chargeAmountKrw: 0,
      providerChargeAmountKrw: 0,
      prorationCreditKrw: 0,
      fullCurrentPaymentRefund: false,
      refundMode: "none",
      refundAmountKrw: 0,
      refundTotalPeriodDays: 0,
      refundUnusedPeriodDays: 0,
      startsNewBillingPeriod: false,
      effectiveAt: action === "unchanged" ? input.now : input.currentPeriodEnd,
      nextChargeAt: input.currentPeriodEnd,
    };
  }

  if (input.currentBillingCycle === "monthly") {
    const targetPrice = periodPrice(input.targetPlan, input.targetBillingCycle);
    const policyRefund = input.sourcePaymentApprovedAt
      && Number.isSafeInteger(input.sourcePaymentAmountKrw)
      ? quoteMonthlyUpgradeRefund({
        sourcePaymentAmountKrw: input.sourcePaymentAmountKrw || 0,
        sourcePaymentApprovedAt: input.sourcePaymentApprovedAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        now: input.now,
      })
      : {
        mode: "none" as const,
        amountKrw: 0,
        totalPeriodDays: 0,
        unusedPeriodDays: 0,
      };
    const refund = (
      isEasycutProPackageReplacement(input.currentPlanCode, input.targetPlanCode)
      && Number.isSafeInteger(input.sourcePaymentAmountKrw)
      && (input.sourcePaymentAmountKrw || 0) > 0
    ) ? {
      mode: "automatic_full" as const,
      amountKrw: input.sourcePaymentAmountKrw || 0,
      totalPeriodDays: policyRefund.totalPeriodDays,
      unusedPeriodDays: policyRefund.totalPeriodDays,
    } : policyRefund;
    return {
      action,
      chargeAmountKrw: targetPrice,
      providerChargeAmountKrw: targetPrice,
      prorationCreditKrw: refund.amountKrw,
      fullCurrentPaymentRefund: refund.mode === "automatic_full",
      refundMode: refund.mode,
      refundAmountKrw: refund.amountKrw,
      refundTotalPeriodDays: refund.totalPeriodDays,
      refundUnusedPeriodDays: refund.unusedPeriodDays,
      startsNewBillingPeriod: true,
      effectiveAt: input.now,
      nextChargeAt: input.targetBillingCycle === "yearly"
        ? input.annualPeriodEnd
        : input.monthlyPeriodEnd,
    };
  }

  const periodMs = input.currentPeriodEnd.getTime() - input.currentPeriodStart.getTime();
  const remainingMs = Math.max(0, input.currentPeriodEnd.getTime() - input.now.getTime());
  if (periodMs <= 0 || remainingMs <= 0) {
    throw new Error("현재 결제기간의 일할 금액을 계산할 수 없습니다.");
  }

  if (action === "immediate_annual_conversion") {
    const unusedCurrentCredit = proratedAmount(
      input.currentPlan.monthlyPriceKrw,
      remainingMs,
      periodMs,
    );
    const annualPrice = input.targetPlan.yearlyPriceKrw;
    const chargeAmountKrw = Math.max(1, annualPrice - unusedCurrentCredit);
    return {
      action,
      chargeAmountKrw,
      providerChargeAmountKrw: chargeAmountKrw,
      prorationCreditKrw: unusedCurrentCredit,
      fullCurrentPaymentRefund: false,
      refundMode: "none",
      refundAmountKrw: 0,
      refundTotalPeriodDays: 0,
      refundUnusedPeriodDays: 0,
      startsNewBillingPeriod: true,
      effectiveAt: input.now,
      nextChargeAt: input.annualPeriodEnd,
    };
  }

  const currentPrice = periodPrice(input.currentPlan, input.currentBillingCycle);
  const targetPrice = periodPrice(input.targetPlan, input.targetBillingCycle);
  const chargeAmountKrw = Math.max(
    1,
    proratedAmount(targetPrice - currentPrice, remainingMs, periodMs),
  );
  const providerChargeAmountKrw = input.targetBillingCycle === "monthly"
    ? targetPrice
    : chargeAmountKrw;
  return {
    action,
    chargeAmountKrw,
    providerChargeAmountKrw,
    prorationCreditKrw: Math.max(0, providerChargeAmountKrw - chargeAmountKrw),
    fullCurrentPaymentRefund: false,
    refundMode: "none",
    refundAmountKrw: 0,
    refundTotalPeriodDays: 0,
    refundUnusedPeriodDays: 0,
    startsNewBillingPeriod: false,
    effectiveAt: input.now,
    nextChargeAt: input.currentPeriodEnd,
  };
}
