import { z } from "zod";

export const CREATOR_SUPPORT_PROGRAM = "creator_support_2026_v1";
export const CREATOR_SUPPORT_PRODUCT_CODE = "creator_support_30min_v1";
export const CREATOR_SUPPORT_TERMS_VERSION = "2026-09-11.v1";
export const CREATOR_SUPPORT_SECONDS = 1_800;
export const CREATOR_SUPPORT_CONTACT = "easycut@easycut.co.kr";

export const creatorSupportTerms = [
  {
    key: "collection", title: "개인정보 수집·이용 동의", required: true,
    paragraphs: [
      "아티룸은 참여 확인, 무료 사용량 지급, 채널 권리 확인, 문의·철회 처리 및 중복 참여 방지를 위해 회원 식별자, 가입일, 로그인 방식, 계정 이름·이메일(제공된 경우), 등록 채널명·주소, 선택 제공한 프로필 이미지, 동의 및 처리 이력을 이용합니다. 이름·이메일을 다시 입력할 필요는 없습니다.",
      "채널 정보·이미지는 홍보 종료 시 삭제합니다. 철회·종료 시 홍보를 중단하고 불필요한 개인정보·소재를 지체 없이 삭제합니다. 동의·처리 상세 이력은 지원 종료 후 1년까지 보관합니다. 중복 참여 확인용 회원 식별자·채널 주소 해시와 지급 연결 기록은 프로그램 운영 중 보관하며, 모집 영구 종료 및 지원·이력 보관 기간 종료 후 삭제합니다. 법령에 따른 보관 의무가 있는 기록은 해당 기간 동안 별도 보관합니다. 기존 가입 정보는 서비스 개인정보 처리방침을 따릅니다.",
      "동의를 거부할 수 있으며 거부 시 본 지원 프로그램에는 참여할 수 없습니다. 일반 이지컷 이용에는 영향을 주지 않습니다. 열람·정정·삭제·처리정지·동의 철회는 easycut@easycut.co.kr로 요청할 수 있습니다. 법정 권리는 이 약정으로 제한되지 않습니다.",
    ],
  },
  {
    key: "disclosure", title: "채널 정보 공개·제공 동의", required: true,
    paragraphs: [
      "공개·제공 항목은 등록한 채널명, 채널 링크, 선택 제공한 프로필 이미지입니다. 신청용 계정 이름과 이메일은 공개하지 않습니다.",
      "목적은 이지컷 파트너 크리에이터 소개와 서비스 홍보입니다. 이지컷 홈페이지·공식 SNS·서비스 소개자료의 열람자에게 공개되며, 인스타그램·페이스북·유튜브 유료 광고의 제작·게재를 위해 해당 광고 플랫폼 운영자(Meta, Google)에 소재로 제공됩니다. 이용 기간은 활성화일부터 1년이며, 종료 시 아티룸이 관리하는 게시·광고 사용을 중단합니다.",
      "동의를 거부할 수 있으며 거부 시 본 프로그램에는 참여할 수 없습니다. 추가 수신자나 새로운 이용 목적·항목이 필요한 경우 별도 고지·동의를 진행합니다. 플랫폼 제공·국외 이전에 필요한 별도 고지 및 법적 요건은 실제 집행 전에 확인합니다.",
    ],
  },
  {
    key: "license", title: "채널 소개·유료 광고 이용약정", required: true,
    paragraphs: [
      "등록한 채널명·링크·제공 이미지를 이지컷의 파트너 크리에이터 소개 및 온라인 유료 광고에 활성화일부터 1년 동안 비독점적으로 사용할 수 있도록 아티룸에 허락합니다. 매체는 이지컷 홈페이지·공식 SNS·서비스 소개자료와 인스타그램·페이스북·유튜브 유료 광고입니다. 실제 사용 전 채널 운영 권한과 소재 권리를 확인합니다.",
      "소개에 필요한 이미지 크기·배치 조정만 허용합니다. 영상, 썸네일, 후기 인용, 얼굴이나 음성의 별도 광고 활용, 의미를 바꾸는 편집에는 추가 허락이 필요합니다. 제공 이미지를 통해 제3자의 권리를 침해하지 않아야 합니다.",
      "지원은 활성화 즉시, 1개월 후, 2개월 후 각 30분입니다. 월별 잔여량은 다음 회차 시작 시 만료되고 이월되지 않습니다. 마지막 회차는 활성화 3개월 후 만료됩니다. 한국 시간 기준 최초 활성화 날짜·시각을 유지하며 없는 날짜는 해당 월 말일로 보정합니다. 유료 요금제 변경이나 자동 결제는 없으며, 지원 사용량 외 별도 소재 사용료는 지급하지 않습니다.",
      "홍보 이용약정은 1년입니다. 개인정보 동의 철회 등 법정 권리를 배제하지 않습니다. 종료 요청은 고객센터에서 확인·처리하며 기본 처리안은 홍보 중단, 미래 회차 취소, 이미 시작한 회차의 기존 만료일 유지입니다. 자동 위약금·환수는 없습니다. 문의·권리 행사: 아티룸 / easycut@easycut.co.kr.",
    ],
  },
] as const;

export type CreatorPlatform = "youtube" | "instagram";
export type CreatorConsentKey = typeof creatorSupportTerms[number]["key"];
export const creatorChannelSchema = z.object({
  platform: z.enum(["youtube", "instagram"]),
  channelUrl: z.string().trim().min(1).max(400),
  channelName: z.string().trim().min(1).max(60).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict();
export const creatorEnrollmentSchema = creatorChannelSchema.extend({
  accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.uuid(),
  assetId: z.uuid().nullable(),
  ownsChannel: z.literal(true),
  termsVersion: z.literal(CREATOR_SUPPORT_TERMS_VERSION),
  consents: z.object({ collection: z.literal(true), disclosure: z.literal(true), license: z.literal(true) }).strict(),
}).strict();
export type CreatorEnrollmentInput = z.infer<typeof creatorEnrollmentSchema>;

export function normalizeCreatorChannel(platform: CreatorPlatform, input: string) {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("채널 주소를 확인해 주세요.");
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  let channelPath: string;
  if (platform === "instagram") {
    if (host !== "instagram.com" || !/^\/[a-zA-Z0-9._]{1,30}$/.test(path)) {
      throw new Error("인스타그램 프로필 주소를 입력해 주세요.");
    }
    const handle = path.slice(1).toLowerCase();
    if (["p", "reel", "reels", "stories", "explore", "accounts", "direct", "about", "developer", "legal"].includes(handle)) {
      throw new Error("게시물 대신 프로필 주소를 입력해 주세요.");
    }
    channelPath = `/${handle}`;
  } else {
    if (host !== "youtube.com") throw new Error("유튜브 채널 주소를 입력해 주세요.");
    if (/^\/channel\/UC[a-zA-Z0-9_-]{22}$/.test(path)) channelPath = path;
    else if (/^\/@[\p{L}\p{N}_.·-]{3,30}$/u.test(path)) channelPath = path.normalize("NFC").toLowerCase();
    else if (/^\/(c|user)\/[\p{L}\p{N}_.-]{1,100}$/u.test(path)) channelPath = path.normalize("NFC").toLowerCase();
    else throw new Error("영상 대신 채널 홈 주소를 입력해 주세요.");
  }
  const channelUrl = `https://${host}${channelPath}`;
  return { channelUrl, channelKey: `${platform}:${channelPath}` };
}

export function maskCreatorName(value: string | null) {
  const chars = Array.from(value?.trim() || "");
  return chars.length ? `${chars[0]}${"*".repeat(Math.min(4, Math.max(1, chars.length - 1)))}` : "이지컷 회원";
}
export function maskCreatorEmail(value: string | null): string | null {
  if (!value || /[*?•…]/.test(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const [local, domain] = value.split("@");
  return `${Array.from(local)[0]}***@${domain}`;
}
export function creatorKstDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } as const : {}),
  }).format(new Date(value));
}

export type CreatorSupportStatus = {
  id: string; channelName: string | null; channelUrl: string | null; platform: CreatorPlatform;
  activatedAt: string; supportEndsAt: string; promotionEndsAt: string; terminatedAt: string | null;
  promotionStatus: "pending" | "approved" | "stopped" | "expired";
  installments: Array<{
    number: number; validFrom: string; expiresAt: string; totalSeconds: number;
    remainingSeconds: number; state: "scheduled" | "available" | "expired" | "canceled";
  }>;
};
export type CreatorSupportMe = {
  account: { key: string; name: string; email: string | null; provider: string; joinedAt: string };
  enrollmentOpen: boolean; termsVersion: string; status: CreatorSupportStatus | null;
};
