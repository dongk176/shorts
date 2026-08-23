import type { User } from "@supabase/supabase-js";
import { getBillingSummary } from "@/lib/billing";
import { getPaymentMethodAction } from "@/lib/billing-payment-method-remediation";
import type { MvpState } from "@/lib/contracts";
import {
  getPublicExampleJobs,
  getPublicMvpState,
  getRecentJobs,
  getSubtitleTemplateUsage,
} from "@/lib/data";
import { getDb } from "@/lib/db";
import { getFileUploadReleaseAccess } from "@/lib/file-upload-release";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import {
  currentKstPeriod,
  getUsageSnapshot,
  isPlanEnforcementEnabled,
} from "@/lib/usage";

export async function loadMvpState(
  authenticatedUser?: User | null,
): Promise<MvpState> {
  const db = getDb();
  const [{ plans, generatedShortCount }, user] = await Promise.all([
    getPublicMvpState(db),
    authenticatedUser === undefined
      ? getAuthenticatedUser()
      : Promise.resolve(authenticatedUser),
  ]);

  if (!user) {
    const selectedPlanCode = "free";
    const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode);
    if (!selectedPlan) throw new Error("기본 플랜 정보를 찾을 수 없습니다.");
    const { start, next } = currentKstPeriod();
    const [billing, recentJobs] = await Promise.all([
      getBillingSummary(db, null),
      getPublicExampleJobs(db),
    ]);

    return {
      sessionId: null,
      user: null,
      selectedPlanCode,
      generatedShortCount,
      plans,
      usage: {
        usedSeconds: 0,
        reservedSeconds: 0,
        limitSeconds: selectedPlan.monthlySourceSeconds,
        remainingSeconds: selectedPlan.monthlySourceSeconds,
        baseUsedSeconds: 0,
        baseReservedSeconds: 0,
        baseLimitSeconds: 0,
        baseRemainingSeconds: 0,
        addonRemainingSeconds: 0,
        periodStart: start.toISOString(),
        nextResetAt: next.toISOString(),
        enforcementEnabled: isPlanEnforcementEnabled(),
      },
      billing,
      paymentMethodAction: null,
      capabilities: { fileUpload: false },
      hasUsedSubtitleTemplates: false,
      recentJobs,
    };
  }

  const session = await requireMvpSession(user, { createIfMissing: false });
  const [
    usage,
    recentJobs,
    billing,
    paymentMethodAction,
    hasUsedSubtitleTemplates,
    fileUploadAccess,
  ] = await Promise.all([
    getUsageSnapshot(db, session),
    getRecentJobs(db, session),
    getBillingSummary(db, session.userId),
    getPaymentMethodAction(db, session.userId),
    getSubtitleTemplateUsage(db, session.userId),
    getFileUploadReleaseAccess(db, session.userId),
  ]);

  return {
    sessionId: session.id,
    user: session.user,
    selectedPlanCode: billing.planCode,
    generatedShortCount,
    plans,
    billing,
    paymentMethodAction,
    usage,
    capabilities: { fileUpload: fileUploadAccess.adminEnabled },
    hasUsedSubtitleTemplates,
    recentJobs,
  };
}
