export const planCodes = ["plus", "standard", "pro"] as const;
export type PlanCode = (typeof planCodes)[number];

export const templateIds = ["dark-red", "white-yellow", "dark-minimal", "paper"] as const;
export type TemplateId = (typeof templateIds)[number];

export const clipLengthOptions = ["sec_30", "sec_31_60", "sec_61_180"] as const;
export type ClipLengthOption = (typeof clipLengthOptions)[number];

export const outputLanguages = ["ko", "en", "ja", "zh-CN", "es", "fr", "de", "pt-BR"] as const;
export type OutputLanguage = (typeof outputLanguages)[number];

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
  clipLengthOption: ClipLengthOption;
  outputLanguage: OutputLanguage;
  expectedShortCount: number;
  status: string;
  stage: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  shorts: GeneratedShort[];
};

export type MvpState = {
  sessionId: string;
  selectedPlanCode: PlanCode;
  plans: Plan[];
  usage: UsageSnapshot;
  recentJobs: VideoJob[];
};

export const clipLengthRules: Record<ClipLengthOption, { min: number; max: number; target: number }> = {
  sec_30: { min: 20, max: 30, target: 29 },
  sec_31_60: { min: 31, max: 60, target: 50 },
  sec_61_180: { min: 61, max: 180, target: 90 },
};

export function expectedShortCount(durationSeconds: number) {
  if (durationSeconds < 240) return 1;
  if (durationSeconds < 600) return 2;
  if (durationSeconds < 1200) return 3;
  if (durationSeconds < 2100) return 4;
  return 5;
}
