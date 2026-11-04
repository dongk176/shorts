import { shortsSilenceEnabled } from "./shorts-silence-contract";
import { shortsSilenceRuntimeEnabled } from "./shorts-silence-access";
import { midformRelease, midformUploadRelease } from "./midform-release";
import { snsTemplateRelease } from "./sns-template-release";
import type { SiteLocale } from "./i18n/config";
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
  locale: SiteLocale = "ko",
  options: { includeRecentJobs?: boolean } = {},
): Promise<MvpState> {
  return withReadRequest("mvp_state", (stage) => readMvpState(stage, authenticatedUser, locale, options.includeRecentJobs !== false), signal);
}

async function readMvpState(
  stage: ReadStage,
  authenticatedUser?: User | null,
  locale: SiteLocale = "ko",
  includeRecentJobs = true,
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
      includeRecentJobs ? stage("examples", () => getPublicExampleJobs(db, locale)) : Promise.resolve([]),
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
        communityTemplate: false,
        snsTemplate: false,
        fileUpload: false,
        customTemplateDesign: false,
        unifiedTemplateSubtitles: false,
        unifiedTemplateSubtitleLocalUpload: false,
      },
      hasUsedSubtitleTemplates: false,
      recentJobs,
      recentJobsLoaded: includeRecentJobs,
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
    includeRecentJobs ? stage("jobs", () => getRecentJobs(db, session, undefined, locale)) : Promise.resolve([]),
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
      shortsSilenceRemoval: session.isAdmin === true && shortsSilenceEnabled() && await shortsSilenceRuntimeEnabled(db),
      midform: session.isAdmin === true ? await Promise.all([midformRelease(db, session.userId), midformUploadRelease(db, session.userId)]).then(() => true).catch(() => false) : false,
      communityTemplate: session.userId !== null
        ? await snsTemplateRelease(db, true).then(() => true).catch(() => false) : false,
      snsTemplate: session.userId !== null
        ? await snsTemplateRelease(db).then(() => true).catch(() => false) : false,
      languageTest: session.userId !== null
        ? await stage("language_access", () => languageTestStatus(db)
          .then((state) => languageFeatureAllowed(state, session.isAdmin === true))
          .catch(() => false))
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
    recentJobsLoaded: includeRecentJobs,
    enterpriseAccess,
  };
}

/** Project reads have their own deadline: a slow list cannot discard account state. */
export async function loadMvpRecentJobs(signal?: AbortSignal, locale: SiteLocale = "ko") {
  return withReadRequest("mvp_recent_jobs", async (stage) => {
    const db = getDb();
    const user = await stage("auth", () => getAuthenticatedUser());
    if (!user) {
      return { userId: null, recentJobs: await stage("examples", () => getPublicExampleJobs(db, locale)) };
    }
    const session = await stage("session", () => requireMvpSession(user, { createIfMissing: false, readOnly: true }));
    if (session.isEnterprise) {
      const access = await stage("enterprise_access", () => getEnterpriseAccessState(db, session.userId!));
      if (!access.allowed) return { userId: session.user?.id ?? null, recentJobs: [] };
    }
    return {
      userId: session.user?.id ?? null,
      recentJobs: await stage("jobs", () => getRecentJobs(db, session, undefined, locale)),
    };
  }, signal);
}
