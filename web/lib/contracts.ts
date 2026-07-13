export const planCodes = ["plus", "standard", "pro"] as const;
export type PlanCode = (typeof planCodes)[number];

export const templateIds = ["dark-red", "white-yellow", "dark-minimal", "paper"] as const;
export type TemplateId = (typeof templateIds)[number];

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
