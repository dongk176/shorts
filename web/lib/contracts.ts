export const planCodes = ["plus", "standard", "pro"] as const;
export type PlanCode = (typeof planCodes)[number];

export const templateIds = ["dark-red", "white-yellow", "dark-minimal", "paper"] as const;
export type TemplateId = (typeof templateIds)[number];

export const videoAspectRatios = ["16:9", "1:1", "4:5", "9:16"] as const;
export type VideoAspectRatio = (typeof videoAspectRatios)[number];

export const videoAspectRatioOptions: Array<{
  value: VideoAspectRatio;
  label: string;
  width: number;
  height: number;
}> = [
  { value: "16:9", label: "가로모드", width: 1080, height: 608 },
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
  periodStart: string;
  nextResetAt: string;
  enforcementEnabled: boolean;
};

export type Plan = {
  code: PlanCode;
  displayName: string;
  monthlySourceSeconds: number;
  retentionDays: number;
};

export type GeneratedShort = {
  id: string;
  clipIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  hookTitle: string;
  channelDisplayName: string;
  subtitleSegments: Array<{ start: number; end: number; text: string }>;
  subtitlesEnabled: boolean;
  templateId: TemplateId;
  videoAspectRatio: VideoAspectRatio;
  titleFontScale: number;
  renderVersion: number;
  rerenderProgress: number;
  status: string;
  expiresAt: string;
};

export type VideoJob = {
  id: string;
  videoTitle: string;
  channelName: string;
  thumbnailUrl: string;
  sourceDurationSeconds: number;
  outputLanguage: OutputLanguage;
  expectedShortCount: number;
  status: string;
  stage: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
  shorts: GeneratedShort[];
};

export type MvpState = {
  sessionId: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  selectedPlanCode: PlanCode;
  generatedShortCount: number;
  plans: Plan[];
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
  // processing budget per selected source minute (31-90 minutes total).
  return 30 + Math.ceil(durationSeconds / 60);
}
