import type { BillingCycle } from "@/lib/contracts";
import { addKstMonths } from "@/lib/billing";

export const adminSubscriptionStatuses = [
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;

export type AdminSubscriptionStatus = typeof adminSubscriptionStatuses[number];
export type AdminSubscriptionProviderAction = "enable" | "pause" | "none";

export function planAdminSubscriptionProviderTransition(input: {
  targetStatus: AdminSubscriptionStatus;
  billingCycle: BillingCycle | null;
  paymentProvider: string | null;
  providerScheduleStatus: string;
  hasUsableThePayOneMethod: boolean;
}) {
  if (input.billingCycle !== "monthly") {
    return {
      action: "none" as const,
      scheduleStatus: "none" as const,
      requiresReview: false,
      reviewReason: null,
    };
  }

  if (input.paymentProvider !== "thepayone" || !input.hasUsableThePayOneMethod) {
    return {
      action: "none" as const,
      scheduleStatus: "manual_review" as const,
      requiresReview: true,
      reviewReason: "ADMIN_PAYMENT_SCHEDULE_UNAVAILABLE",
    };
  }

  if (input.targetStatus === "active") {
    return {
      action: "enable" as const,
      scheduleStatus: "active" as const,
      requiresReview: false,
      reviewReason: null,
    };
  }

  const alreadyPaused = ["paused", "disposed"].includes(input.providerScheduleStatus);
  return {
    action: alreadyPaused ? "none" as const : "pause" as const,
    scheduleStatus: "paused" as const,
    requiresReview: false,
    reviewReason: null,
  };
}

export function planAdminSubscriptionPeriod(input: {
  targetStatus: AdminSubscriptionStatus;
  billingCycle: BillingCycle | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  billingAnchorDay: number | null;
  now: Date;
}) {
  if (input.targetStatus !== "active") {
    return {
      periodStart: input.currentPeriodStart,
      periodEnd: input.currentPeriodEnd,
      nextChargeAt: null,
      periodReset: false,
    };
  }

  if (
    input.currentPeriodStart
    && input.currentPeriodEnd
    && input.currentPeriodStart <= input.now
    && input.currentPeriodEnd > input.now
  ) {
    return {
      periodStart: input.currentPeriodStart,
      periodEnd: input.currentPeriodEnd,
      nextChargeAt: input.currentPeriodEnd,
      periodReset: false,
    };
  }

  const periodStart = input.now;
  const periodEnd = addKstMonths(
    periodStart,
    input.billingCycle === "yearly" ? 12 : 1,
    input.billingCycle === "monthly" ? input.billingAnchorDay || undefined : undefined,
  );
  return {
    periodStart,
    periodEnd,
    nextChargeAt: periodEnd,
    periodReset: true,
  };
}
