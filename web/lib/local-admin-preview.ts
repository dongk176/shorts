import type { MvpState, YoutubeAnalysis } from "@/lib/contracts";
import {
  createDefaultTemplateConfig,
  type CustomTemplate,
} from "@/lib/template-config";

export const LOCAL_ADMIN_PREVIEW_QUERY_KEY = "localAdminPreview";

export function localAdminPreviewEnvironmentEnabled(input: {
  nodeEnv: string | undefined;
  featureFlag: string | undefined;
}) {
  return input.nodeEnv === "development" && input.featureFlag === "true";
}

export function localAdminPreviewEnabled(input: {
  nodeEnv: string | undefined;
  featureFlag: string | undefined;
  queryValue: string | string[] | undefined;
}) {
  const queryValue = Array.isArray(input.queryValue)
    ? input.queryValue[0]
    : input.queryValue;
  return localAdminPreviewEnvironmentEnabled(input)
    && queryValue === "1";
}

export function createLocalAdminPreviewState(): MvpState {
  const periodStart = "2026-08-01T00:00:00.000Z";
  const periodEnd = "2026-09-01T00:00:00.000Z";
  const monthlySourceSeconds = 120 * 60;
  return {
    sessionId: "local-admin-preview-session",
    user: {
      id: "local-admin-preview-user",
      email: "local-admin@easycut.test",
      displayName: "로컬 어드민",
      avatarUrl: null,
    },
    selectedPlanCode: "easycut_pro_v2",
    generatedShortCount: 14_321,
    plans: [{
      code: "easycut_pro_v2",
      displayName: "이지컷 프로",
      monthlySourceSeconds,
      retentionDays: 30,
      monthlyPriceKrw: 9_900,
      yearlyPriceKrw: 118_800,
      maxActiveJobs: 1,
    }],
    billing: {
      hasPaymentHistory: true,
      lastPaidPlanCode: "easycut_pro_v2",
      lastPaidBillingCycle: "monthly",
      lastPaidAt: periodStart,
      purchasedPackageCodes: [],
      activeProducts: [{
        planCode: "easycut_pro_v2",
        displayName: "이지컷 프로",
        billingCycle: "monthly",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,
        cancelAtPeriodEnd: false,
        monthlySourceSeconds,
      }],
      hasManagedFeatureAccess: true,
      status: "active",
      planCode: "easycut_pro_v2",
      billingCycle: "monthly",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextChargeAt: periodEnd,
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
      scheduledBillingCycle: null,
      cardIssuer: "로컬 테스트 카드",
      cardNumberMasked: "0000********0000",
      cardLast4: "0000",
      hasStoredPayerTel: false,
      paymentProvider: null,
      providerScheduleStatus: "none",
      requiresManualReview: false,
      canCreateJobs: true,
      maxActiveJobs: 1,
      retentionDays: 30,
    },
    usage: {
      usedSeconds: 0,
      reservedSeconds: 0,
      limitSeconds: monthlySourceSeconds,
      remainingSeconds: monthlySourceSeconds,
      baseUsedSeconds: 0,
      baseReservedSeconds: 0,
      baseLimitSeconds: monthlySourceSeconds,
      baseRemainingSeconds: monthlySourceSeconds,
      addonRemainingSeconds: 0,
      periodStart,
      nextResetAt: periodEnd,
      enforcementEnabled: true,
    },
    recentJobs: [],
  };
}

export function createLocalAdminPreviewAnalysis(): YoutubeAnalysis {
  return {
    analysisId: "local-admin-preview-analysis",
    sourceRangeSelectionEnabled: true,
    subtitleTemplateSelectionEnabled: true,
    brandColorSelectionEnabled: true,
    videoId: "aqz-KE-bpKQ",
    normalizedUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    title: "로컬에서 바로 확인하는 어드민 템플릿 미리보기",
    channelName: "Easy Cut 로컬 테스트",
    channelThumbnailUrl: null,
    thumbnailUrl: "/easy-cut-og-1200x630-v3.jpg",
    durationSeconds: 15 * 60 + 53,
    expectedShortCount: 8,
    creationAllowed: true,
    creationBlockCode: null,
    creationBlockReason: null,
  };
}

export function createLocalAdminPreviewTemplates(): CustomTemplate[] {
  const createdAt = "2026-08-10T00:00:00.000Z";
  return [
    {
      id: "local-comment-template",
      name: "로컬 댓글 템플릿",
      baseTemplateId: "comment-capture",
      config: createDefaultTemplateConfig("comment-capture"),
      version: 1,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "local-minimal-template",
      name: "로컬 미니멀 템플릿",
      baseTemplateId: "dark-minimal",
      config: createDefaultTemplateConfig("dark-minimal"),
      version: 1,
      createdAt,
      updatedAt: createdAt,
    },
  ];
}
