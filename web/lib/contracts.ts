export const planCodes = [
  "free",
  "plus",
  "standard",
  "pro",
  "easycut_pro_v2",
  "starter_3m",
  "starter_6m",
  "starter_12m",
  "expert_3m",
  "expert_6m",
  "expert_12m",
] as const;
export type PlanCode = (typeof planCodes)[number];

export const paidPlanCodes = [
  "plus",
  "standard",
  "pro",
  "easycut_pro_v2",
  "starter_3m",
  "starter_6m",
  "starter_12m",
  "expert_3m",
  "expert_6m",
  "expert_12m",
] as const;
export type PaidPlanCode = (typeof paidPlanCodes)[number];

export const billingCycles = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof billingCycles)[number];

export const subscriptionStatuses = ["none", "pending", "active", "past_due", "canceled", "expired"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const templateIds = ["dark-red", "white-yellow", "dark-minimal", "paper", "comment-capture"] as const;
export type TemplateId = (typeof templateIds)[number];

export type CommentOverlay = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  initial: string;
  avatarColor: string;
  nickname: string;
  likeCount: number;
  ageLabel: string;
};

export type TitleTextStyle = {
  start: number;
  end: number;
  color?: string;
  backgroundColor?: string;
};

export const videoAspectRatios = ["16:9", "5:4", "1:1", "4:5", "9:16"] as const;
export type VideoAspectRatio = (typeof videoAspectRatios)[number];

export const videoAspectRatioOptions: Array<{
  value: VideoAspectRatio;
  label: string;
  width: number;
  height: number;
}> = [
  { value: "16:9", label: "가로모드", width: 1080, height: 608 },
  { value: "5:4", label: "가로 5:4", width: 1080, height: 864 },
  { value: "1:1", label: "정사각형", width: 1080, height: 1080 },
  { value: "4:5", label: "세로형", width: 1080, height: 1350 },
  { value: "9:16", label: "세로 꽉참", width: 1080, height: 1920 },
];

export const outputLanguages = ["ko", "en", "ja", "zh-CN", "es", "fr", "de", "pt-BR"] as const;
export type OutputLanguage = (typeof outputLanguages)[number];

export const AI_CLIP_MIN_SECONDS = 30;
export const AI_CLIP_MAX_SECONDS = 60;

export const outputLanguageOptions: Array<{ code: OutputLanguage; label: string }> = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "영어" },
  { code: "ja", label: "일본어" },
  { code: "zh-CN", label: "중국어(간체)" },
  { code: "es", label: "스페인어" },
  { code: "fr", label: "프랑스어" },
  { code: "de", label: "독일어" },
  { code: "pt-BR", label: "포르투갈어(브라질)" },
];

export type UsageSnapshot = {
  usedSeconds: number;
  reservedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  baseUsedSeconds: number;
  baseReservedSeconds: number;
  baseLimitSeconds: number;
  baseRemainingSeconds: number;
  addonRemainingSeconds: number;
  periodStart: string;
  nextResetAt: string;
  enforcementEnabled: boolean;
};

export type ActiveBillingProduct = {
  planCode: PaidPlanCode;
  displayName: string;
  billingCycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  monthlySourceSeconds: number;
};

export type BillingSummary = {
  hasPaymentHistory: boolean;
  lastPaidPlanCode: PaidPlanCode | null;
  lastPaidBillingCycle: BillingCycle | null;
  lastPaidAt: string | null;
  purchasedPackageCodes: PaidPlanCode[];
  activeProducts: ActiveBillingProduct[];
  hasManagedFeatureAccess: boolean;
  status: SubscriptionStatus;
  planCode: PlanCode;
  billingCycle: BillingCycle | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanCode: PaidPlanCode | null;
  scheduledBillingCycle: BillingCycle | null;
  cardIssuer: string | null;
  cardNumberMasked: string | null;
  cardLast4: string | null;
  hasStoredPayerTel: boolean;
  paymentProvider: "thepayone" | "nicepay" | null;
  providerScheduleStatus: "none" | "active" | "paused" | "disposed" | "manual_review";
  requiresManualReview: boolean;
  canCreateJobs: boolean;
  maxActiveJobs: number;
  retentionDays: number;
};

export type YoutubeAnalysis = {
  analysisId: string;
  sourceRangeSelectionEnabled: boolean;
  subtitleTemplateSelectionEnabled: boolean;
  brandColorSelectionEnabled: boolean;
  videoId: string;
  normalizedUrl: string;
  title: string;
  channelName: string;
  channelThumbnailUrl: string | null;
  thumbnailUrl: string;
  durationSeconds: number;
  expectedShortCount: number;
  creationAllowed: boolean;
  creationBlockCode: YoutubeCreationBlockCode | null;
  creationBlockReason: string | null;
};

export const youtubeCreationBlockCodes = [
  "region_restricted",
  "age_restricted",
  "not_public",
  "removed",
  "copyright_restricted",
  "authentication_required",
  "members_only",
  "paid_content",
  "drm_protected",
  "not_yet_available",
  "playback_unavailable",
  "not_processed",
  "embedding_disabled",
  "availability_unverified",
  "bot_challenge",
] as const;

export type YoutubeCreationBlockCode = typeof youtubeCreationBlockCodes[number];

export type Plan = {
  code: PlanCode;
  displayName: string;
  monthlySourceSeconds: number;
  retentionDays: number;
  monthlyPriceKrw: number;
  yearlyPriceKrw: number;
  maxActiveJobs: number;
};

export type GeneratedShort = {
  id: string;
  clipIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  selectionRawStartSeconds?: number | null;
  selectionRawEndSeconds?: number | null;
  selectionRawDurationSeconds?: number | null;
  selectionCandidateIndex?: number | null;
  selectionLengthAdjustment?: "none" | "min_clamp" | "max_clamp" | null;
  selectionRepositioned?: boolean | null;
  hookTitle: string;
  highlightReason: string;
  channelDisplayName: string;
  subtitleSegments: Array<{ start: number; end: number; text: string }>;
  commentOverlays: CommentOverlay[];
  subtitlesEnabled: boolean;
  subtitleTemplateId?: import("./subtitle-templates").SubtitleTemplateId | null;
  templateId: TemplateId;
  customTemplateId?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  videoAspectRatio: VideoAspectRatio;
  titleFontScale: number;
  titleTextStyles: TitleTextStyle[];
  titleTextStylesInitialized: boolean;
  renderVersion: number;
  editorDocument?: import("./editor-document-snapshot").EditorDocumentSnapshot | null;
  rerenderProgress: number;
  status: string;
  expiresAt: string | null;
};

export type VideoJob = {
  id: string;
  projectNumber: number;
  isExample: boolean;
  videoTitle: string;
  channelName: string;
  channelThumbnailUrl: string | null;
  thumbnailUrl: string;
  sourceDurationSeconds: number;
  outputLanguage: OutputLanguage;
  expectedShortCount: number;
  plannedShortCount: number;
  readyShortCount: number;
  failedShortCount: number;
  renderSuccessPercent: number | null;
  status: string;
  stage: string;
  progress: number;
  stageCompletedCount: number;
  stageTotalCount: number;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
  shorts: GeneratedShort[];
};

export type MvpState = {
  sessionId: string | null;
  user: {
    id: string;
    email: string | null;
    loginId?: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  selectedPlanCode: PlanCode;
  generatedShortCount: number;
  plans: Plan[];
  billing: BillingSummary;
  usage: UsageSnapshot;
  recentJobs: VideoJob[];
};

export function expectedShortCount(durationSeconds: number) {
  if (durationSeconds < 240) return 3;
  if (durationSeconds < 600) return 5;
  if (durationSeconds < 1200) return 8;
  if (durationSeconds < 1800) return 10;
  if (durationSeconds < 2700) return 12;
  return 15;
}

export function minimumShortCount(durationSeconds: number) {
  return durationSeconds < 240 ? 1 : 2;
}

export function jobDeadlineMinutes(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) {
    throw new Error("작업 제한 시간을 계산할 수 없는 영상 길이입니다.");
  }
  // Allow a 30-minute fixed overhead for queueing/retries plus one minute of
  // processing budget per full source minute (31-90 minutes total).
  return 30 + Math.ceil(durationSeconds / 60);
}

export function sourceRangeJobDeadlineMinutes(sourceDurationSeconds: number) {
  if (
    !Number.isFinite(sourceDurationSeconds)
    || sourceDurationSeconds <= 0
    || sourceDurationSeconds > 4 * 60 * 60
  ) {
    throw new Error("구간 선택 작업 제한 시간을 계산할 수 없는 영상 길이입니다.");
  }
  return Math.min(270, 30 + Math.ceil(sourceDurationSeconds / 60));
}
