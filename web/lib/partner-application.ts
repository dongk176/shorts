import { z } from "zod";

export const partnerApplicationChannelTypes = [
  "youtube",
  "instagram",
  "tiktok",
  "blog",
  "community",
  "other",
] as const;

export const partnerApplicationAudienceSizes = [
  "under_1000",
  "1000_5000",
  "5000_10000",
  "10000_50000",
  "over_50000",
] as const;

export const partnerApplicationIncomeGoals = [
  "under_100",
  "over_300",
  "over_1000",
] as const;

export const partnerApplicationStatuses = [
  "new",
  "reviewing",
  "contacted",
  "accepted",
  "rejected",
] as const;

export type PartnerApplicationChannelType = (typeof partnerApplicationChannelTypes)[number];
export type PartnerApplicationAudienceSize = (typeof partnerApplicationAudienceSizes)[number];
export type PartnerApplicationIncomeGoal = (typeof partnerApplicationIncomeGoals)[number];
export type PartnerApplicationStatus = (typeof partnerApplicationStatuses)[number];

export const partnerApplicationChannelLabels: Record<PartnerApplicationChannelType, string> = {
  youtube: "유튜브",
  instagram: "인스타그램",
  tiktok: "틱톡",
  blog: "블로그",
  community: "커뮤니티",
  other: "기타",
};

export const partnerApplicationAudienceLabels: Record<PartnerApplicationAudienceSize, string> = {
  under_1000: "1천 미만",
  "1000_5000": "1천 ~ 5천",
  "5000_10000": "5천 ~ 1만",
  "10000_50000": "1만 ~ 5만",
  over_50000: "5만 이상",
};

export const partnerApplicationIncomeLabels: Record<PartnerApplicationIncomeGoal, string> = {
  under_100: "월 100만원 미만",
  over_300: "월 300만원 이상",
  over_1000: "월 1,000만원 이상",
};

export const partnerApplicationStatusLabels: Record<PartnerApplicationStatus, string> = {
  new: "신규",
  reviewing: "검토 중",
  contacted: "연락 완료",
  accepted: "선정",
  rejected: "미선정",
};

export const PARTNER_APPLICATION_CONSENT_VERSION = "partner-application-v1";
export const PARTNER_APPLICATION_MAX_PER_EMAIL_PER_DAY = 3;
export const PARTNER_APPLICATION_MAX_PER_IP_PER_DAY = 5;

const phoneSchema = z.string()
  .trim()
  .min(8)
  .max(24)
  .regex(/^\+?[0-9 ()-]+$/)
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    return value.startsWith("+") ? `+${digits}` : digits;
  })
  .pipe(z.string().regex(/^\+?[0-9]{8,20}$/));

const secureChannelUrlSchema = z.string()
  .trim()
  .min(3)
  .max(2048)
  .transform((value) => {
    if (/^http:\/\//i.test(value)) return value.replace(/^http:\/\//i, "https://");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, "")}`;
  })
  .pipe(z.string().url())
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, {
    message: "채널 주소는 https://로 시작해야 합니다.",
  });

export const partnerApplicationSubmissionSchema = z.object({
  requestId: z.uuid(),
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  phone: phoneSchema,
  channelTypes: z.array(z.enum(partnerApplicationChannelTypes)).min(1).max(6)
    .transform((values) => [...new Set(values)]),
  channelUrl: secureChannelUrlSchema,
  audienceSize: z.enum(partnerApplicationAudienceSizes),
  promotionPlan: z.string().trim().min(5).max(1000),
  incomeGoal: z.enum(partnerApplicationIncomeGoals),
  disclosureAgreed: z.literal(true),
  antiAbuseAgreed: z.literal(true),
  privacyAgreed: z.literal(true),
  consentVersion: z.literal(PARTNER_APPLICATION_CONSENT_VERSION),
});

const partnerApplicationValidationMessages: Record<string, string> = {
  requestId: "접수번호를 만들지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  displayName: "이름 또는 활동명을 입력해 주세요.",
  email: "사용 가능한 이메일 주소를 입력해 주세요.",
  phone: "연락 가능한 전화번호를 숫자 8~20자리로 입력해 주세요.",
  channelTypes: "운영 중인 채널을 하나 이상 선택해 주세요.",
  channelUrl: "대표 채널 주소나 링크를 입력해 주세요. https://는 생략해도 됩니다.",
  audienceSize: "채널 규모를 선택해 주세요.",
  promotionPlan: "이지컷을 소개할 방법을 5자 이상 간단히 입력해 주세요.",
  incomeGoal: "원하는 월 수익을 선택해 주세요.",
  disclosureAgreed: "추천·제휴 관계 표시 원칙에 동의해 주세요.",
  antiAbuseAgreed: "부정 홍보 방지 원칙에 동의해 주세요.",
  privacyAgreed: "파트너 심사를 위한 개인정보 수집·이용에 동의해 주세요.",
  consentVersion: "동의 정보를 확인하지 못했습니다. 페이지를 새로고침해 주세요.",
};

export function partnerApplicationValidationError(input: unknown) {
  const result = partnerApplicationSubmissionSchema.safeParse(input);
  if (result.success) return null;
  const field = typeof result.error.issues[0]?.path[0] === "string"
    ? String(result.error.issues[0].path[0])
    : "form";
  return {
    field,
    message: partnerApplicationValidationMessages[field]
      || "필수 입력 항목을 다시 확인해 주세요.",
  };
}

export function partnerApplicationReferenceCode(id: string) {
  return `PA-${id.slice(0, 8).toUpperCase()}`;
}
