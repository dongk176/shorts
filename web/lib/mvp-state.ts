import { languageFeatureAllowed, languageTestStatus } from "./language-test";
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
import { withReadRequest, type ReadStage } from "@/lib/read-request";
import { getEnterpriseAccessState } from "@/lib/enterprise-access";
import { getFileUploadReleaseAccess } from "@/lib/file-upload-release";
import { getCustomTemplateDesignAccess } from "@/lib/custom-template-design-access";
import {
  getEffectiveSubtitleTemplateAccess,
  unifiedTemplateSubtitleLocalUploadEnabled,
} from "@/lib/subtitle-template-release";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import {
  currentKstPeriod,
  getUsageSnapshot,
  isPlanEnforcementEnabled,
} from "@/lib/usage";

export async function loadMvpState(
  authenticatedUser?: User | null,
  signal?: AbortSignal,
): Promise<MvpState> {
  return withReadRequest("mvp_state", (stage) => readMvpState(stage, authenticatedUser), signal);
}

async function readMvpState(
  stage: ReadStage,
  authenticatedUser?: User | null,
): Promise<MvpState> {
  const db = getDb();
  const [{ plans, generatedShortCount, reusableViewCounter }, user] = await Promise.all([
    stage("public_state", () => getPublicMvpState(db)),
    stage("auth", () => authenticatedUser === undefined
      ? getAuthenticatedUser()
      : Promise.resolve(authenticatedUser)),
  ]);
  const reusableViewCounterState = reusableViewCounter
    ? { ...reusableViewCounter, serverNow: new Date().toISOString() }
    : null;

  if (!user) {
    const selectedPlanCode = "free";
    const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode);
    if (!selectedPlan) throw new Error("기본 플랜 정보를 찾을 수 없습니다.");
    const { start, next } = currentKstPeriod();
    const [billing, recentJobs] = await Promise.all([
      stage("billing", () => getBillingSummary(db, null)),
      stage("examples", () => getPublicExampleJobs(db)),
    ]);

    return {
      sessionId: null,
      user: null,
      selectedPlanCode,
      generatedShortCount,
      reusableViewCounter: reusableViewCounterState,
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
      capabilities: {
        fileUpload: false,
        customTemplateDesign: false,
        unifiedTemplateSubtitles: false,
        unifiedTemplateSubtitleLocalUpload: false,
      },
      hasUsedSubtitleTemplates: false,
      recentJobs,
      enterpriseAccess: { accountType: "personal", allowed: true },
    };
  }

  const session = await stage("session", () => requireMvpSession(user, { createIfMissing: false, readOnly: true }));
  const subtitleTemplateAccessPromise = stage("subtitle_access", () => getEffectiveSubtitleTemplateAccess(
    db,
    session.userId,
  ));
  const [
    usage,
    recentJobs,
    billing,
    paymentMethodAction,
    hasUsedSubtitleTemplates,
    fileUploadAccess,
    subtitleTemplateAccess,
    enterpriseAccess,
    customTemplateDesignAccess,
  ] = await Promise.all([
    stage("usage", () => getUsageSnapshot(db, session)),
    stage("jobs", () => getRecentJobs(db, session)),
    stage("billing", () => getBillingSummary(db, session.userId)),
    stage("payment_method_action", () => getPaymentMethodAction(db, session.userId)),
    stage("subtitle_usage", () => getSubtitleTemplateUsage(db, session.userId)),
    stage("file_upload_access", () => getFileUploadReleaseAccess(db, session.userId)),
    subtitleTemplateAccessPromise,
    session.isEnterprise === true
      ? stage("enterprise_access", () => getEnterpriseAccessState(db, session.userId!))
      : Promise.resolve({ accountType: "personal" as const, allowed: true as const }),
    stage("custom_template_access", () => getCustomTemplateDesignAccess(db, session.userId)),
  ]);

  return {
    sessionId: session.id,
    user: session.user,
    selectedPlanCode: billing.planCode,
    generatedShortCount,
    reusableViewCounter: reusableViewCounterState,
    plans,
    billing,
    paymentMethodAction,
    usage,
    capabilities: {
      languageTest: session.userId !== null
        ? await languageTestStatus(db).then((s) => languageFeatureAllowed(s, session.isAdmin === true)).catch(() => false)
        : false,
      fileUpload: fileUploadAccess.enabled,
      customTemplateDesign: customTemplateDesignAccess.enabled,
      unifiedTemplateSubtitles:
        subtitleTemplateAccess?.unifiedEnabled === true,
      unifiedTemplateSubtitleLocalUpload:
        unifiedTemplateSubtitleLocalUploadEnabled({
          strictAccessEnabled:
            subtitleTemplateAccess?.unifiedEnabled === true,
          fileUploadAdminEnabled: fileUploadAccess.adminEnabled,
        }),
    },
    hasUsedSubtitleTemplates,
    recentJobs,
    enterpriseAccess,
  };
}
