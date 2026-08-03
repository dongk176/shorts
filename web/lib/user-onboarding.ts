import { z } from "zod";

export const USER_ONBOARDING_VERSION = 2;

export const userOccupationOptions = [
  { value: "creator", label: "크리에이터·유튜버" },
  { value: "marketing", label: "마케팅·광고" },
  { value: "brand", label: "쇼핑몰·브랜드 운영" },
  { value: "video_production", label: "영상 제작·편집" },
  { value: "education", label: "교육·강의" },
  { value: "employee_freelancer", label: "회사원·프리랜서" },
  { value: "other", label: "기타" },
] as const;

export const userUsagePurposeOptions = [
  { value: "youtube_shorts", label: "유튜브 쇼츠 제작" },
  { value: "instagram_reels", label: "인스타그램 릴스 제작" },
  { value: "tiktok", label: "틱톡 영상 제작" },
  { value: "promotion", label: "상품·서비스 홍보" },
  { value: "education_content", label: "강의·정보 콘텐츠 제작" },
  { value: "save_editing_time", label: "영상 편집 시간 절약" },
  { value: "monetization", label: "수익화 콘텐츠 제작" },
  { value: "other", label: "기타" },
] as const;

export const userDiscoverySourceOptions = [
  { value: "instagram", label: "인스타그램" },
  { value: "youtube", label: "유튜브" },
  { value: "tiktok", label: "틱톡" },
  { value: "friend_referral", label: "지인 추천" },
  { value: "direct_search", label: "네이버·구글 직접 검색" },
  { value: "blog_community", label: "블로그·커뮤니티" },
  { value: "other", label: "기타" },
] as const;

export const userOccupationValues = userOccupationOptions.map((option) => option.value) as [
  (typeof userOccupationOptions)[number]["value"],
  ...(typeof userOccupationOptions)[number]["value"][],
];
export const userUsagePurposeValues = userUsagePurposeOptions.map((option) => option.value) as [
  (typeof userUsagePurposeOptions)[number]["value"],
  ...(typeof userUsagePurposeOptions)[number]["value"][],
];
export const userDiscoverySourceValues = userDiscoverySourceOptions.map((option) => option.value) as [
  (typeof userDiscoverySourceOptions)[number]["value"],
  ...(typeof userDiscoverySourceOptions)[number]["value"][],
];

export type UserOccupation = (typeof userOccupationOptions)[number]["value"];
export type UserUsagePurpose = (typeof userUsagePurposeOptions)[number]["value"];
export type UserDiscoverySource = (typeof userDiscoverySourceOptions)[number]["value"];

export const userOnboardingSubmissionSchema = z.object({
  requestId: z.string().uuid(),
  occupation: z.enum(userOccupationValues),
  occupationOther: z.string().trim().min(1).max(100).nullable().optional(),
  usagePurposes: z.array(z.enum(userUsagePurposeValues))
    .min(1)
    .max(userUsagePurposeValues.length)
    .refine((values) => new Set(values).size === values.length),
  usagePurposeOther: z.string().trim().min(1).max(100).nullable().optional(),
  discoverySource: z.enum(userDiscoverySourceValues),
  discoverySourceOther: z.string().trim().min(1).max(100).nullable().optional(),
}).superRefine((value, context) => {
  if (value.occupation === "other" && !value.occupationOther) {
    context.addIssue({
      code: "custom",
      path: ["occupationOther"],
      message: "직업을 직접 입력해 주세요.",
    });
  }
  if (value.usagePurposes.includes("other") && !value.usagePurposeOther) {
    context.addIssue({
      code: "custom",
      path: ["usagePurposeOther"],
      message: "이용 목적을 직접 입력해 주세요.",
    });
  }
  if (value.discoverySource === "other" && !value.discoverySourceOther) {
    context.addIssue({
      code: "custom",
      path: ["discoverySourceOther"],
      message: "이지컷을 알게 된 경로를 직접 입력해 주세요.",
    });
  }
}).transform((value) => ({
  ...value,
  occupationOther: value.occupation === "other" ? value.occupationOther! : null,
  usagePurposeOther: value.usagePurposes.includes("other") ? value.usagePurposeOther! : null,
  discoverySourceOther: value.discoverySource === "other" ? value.discoverySourceOther! : null,
}));

export type UserOnboardingStatus = {
  required: boolean;
  version: number;
  storedVersion: number | null;
};
