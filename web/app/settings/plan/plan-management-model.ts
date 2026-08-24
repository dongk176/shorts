import type { BillingSummary } from "@/lib/contracts";
import {
  formatStoredCardLabel,
  resolveStoredCardIssuer,
} from "@/lib/billing-card";
import { getPricingV2Plan } from "@/lib/pricing-v2";
import type { TossBillingState } from "@/lib/toss-billing-state";

export type ManagedPlan = {
  id: string;
  name: string;
  termLabel: string | null;
  monthlyMinutes: number;
  maxActiveJobs: number | null;
  guidebookIncluded: boolean | null;
  periodStart: string;
  periodEnd: string;
  nextQuotaAt: string | null;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  canCancel: boolean;
  kind: "subscription" | "package";
};

export type ManagedNextPlan = {
  name: string;
  termLabel: string | null;
  monthlyMinutes: number;
  maxActiveJobs: number | null;
  guidebookIncluded: boolean | null;
  effectiveAt: string;
};

export type ManagedPaymentMethod = {
  providerLabel: string;
  issuer: string | null;
  cardLabel: string | null;
};

export type PlanManagementView = {
  plans: ManagedPlan[];
  nextPlan: ManagedNextPlan | null;
  paymentMethod: ManagedPaymentMethod | null;
  canResume: boolean;
};

function paymentMethod(input: {
  providerLabel: string;
  issuer?: string | null;
  cardNumberMasked?: string | null;
  cardLast4?: string | null;
}): ManagedPaymentMethod | null {
  const issuer = resolveStoredCardIssuer({
    issuer: input.issuer,
    cardNumberMasked: input.cardNumberMasked,
  });
  const cardLabel = formatStoredCardLabel({ last4: input.cardLast4 });
  if (!issuer && !cardLabel && !input.cardNumberMasked) return null;
  return { providerLabel: input.providerLabel, issuer, cardLabel };
}

export function tossPlanManagementView(state: TossBillingState | null): PlanManagementView {
  const subscription = state?.subscription;
  if (!subscription) {
    return { plans: [], nextPlan: null, paymentMethod: null, canResume: false };
  }
  const plan = subscription.plan;
  const scheduled = subscription.scheduledPlan;
  return {
    plans: [{
      id: subscription.id,
      name: plan.displayName,
      termLabel: `${plan.contractMonths}개월`,
      monthlyMinutes: Math.floor(plan.monthlyQuotaSeconds / 60),
      maxActiveJobs: plan.maxActiveJobs,
      guidebookIncluded: plan.guidebookIncluded,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      nextQuotaAt: subscription.nextQuotaAt,
      nextChargeAt: scheduled ? null : subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canCancel: !subscription.cancelAtPeriodEnd,
      kind: "subscription",
    }],
    nextPlan: scheduled && subscription.scheduledChangeEffectiveAt && !subscription.cancelAtPeriodEnd
      ? {
          name: scheduled.displayName,
          termLabel: `${scheduled.contractMonths}개월`,
          monthlyMinutes: Math.floor(scheduled.monthlyQuotaSeconds / 60),
          maxActiveJobs: scheduled.maxActiveJobs,
          guidebookIncluded: scheduled.guidebookIncluded,
          effectiveAt: subscription.scheduledChangeEffectiveAt,
        }
      : null,
    paymentMethod: paymentMethod({
      providerLabel: "토스페이먼츠",
      issuer: subscription.paymentMethod.issuerCode,
      cardNumberMasked: subscription.paymentMethod.cardNumberMasked,
      cardLast4: subscription.paymentMethod.cardLast4,
    }),
    canResume: subscription.cancelAtPeriodEnd,
  };
}

export function thePayOnePlanManagementView(state: BillingSummary | null): PlanManagementView {
  if (!state) {
    return { plans: [], nextPlan: null, paymentMethod: null, canResume: false };
  }
  const plans = state.activeProducts.map((product): ManagedPlan => {
    const catalogPlan = getPricingV2Plan(product.planCode);
    const isMonthlyEasyCut = product.planCode === "easycut_pro_v2"
      && product.billingCycle === "monthly";
    return {
      id: `${product.planCode}:${product.currentPeriodStart}`,
      name: product.displayName,
      termLabel: catalogPlan?.durationMonths
        ? catalogPlan.durationMonths === 1 ? "매월 갱신" : `${catalogPlan.durationMonths}개월`
        : product.billingCycle === "monthly" ? "매월 갱신" : null,
      monthlyMinutes: Math.floor(product.monthlySourceSeconds / 60),
      maxActiveJobs: null,
      guidebookIncluded: catalogPlan ? catalogPlan.kind === "package" : null,
      periodStart: product.currentPeriodStart,
      periodEnd: product.currentPeriodEnd,
      nextQuotaAt: null,
      nextChargeAt: product.nextChargeAt,
      cancelAtPeriodEnd: product.cancelAtPeriodEnd,
      canCancel: isMonthlyEasyCut
        && state.paymentProvider === "thepayone"
        && !product.cancelAtPeriodEnd,
      kind: isMonthlyEasyCut ? "subscription" : "package",
    };
  });
  const scheduled = !state.cancelAtPeriodEnd
    ? getPricingV2Plan(state.scheduledPlanCode)
    : null;
  const effectiveAt = state.currentPeriodEnd
    ?? plans.find((plan) => plan.kind === "subscription")?.periodEnd
    ?? null;
  return {
    plans,
    nextPlan: scheduled && effectiveAt
      ? {
          name: scheduled.displayName,
          termLabel: scheduled.durationMonths === 1 ? "매월 갱신" : `${scheduled.durationMonths}개월`,
          monthlyMinutes: scheduled.monthlyMinutes,
          maxActiveJobs: null,
          guidebookIncluded: scheduled.kind === "package",
          effectiveAt,
        }
      : null,
    paymentMethod: paymentMethod({
      providerLabel: state.paymentProvider === "nicepay" ? "나이스페이" : "더페이원",
      issuer: state.cardIssuer,
      cardNumberMasked: state.cardNumberMasked,
      cardLast4: state.cardLast4,
    }),
    canResume: false,
  };
}
