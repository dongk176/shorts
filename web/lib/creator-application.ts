import { z } from "zod";
import { normalizeCreatorChannel, type CreatorPlatform } from "./creator-support";

export const CREATOR_APPLICATION_TERMS_VERSION = "2026-09-11.v2";
export const CREATOR_APPLICATION_MINUTES = 100;
export const CREATOR_APPLICATION_LIMIT = 10;
export const CREATOR_APPLICATION_PRODUCT_CODE = "creator_support_100min_v2";
export const creatorApplicationTerms = [
  { key: "collection", title: "개인정보 수집·이용 동의", required: true, paragraphs: [
    "아티룸은 파트너 신청 검토·선정, 선정자 개별 연락, 제작 사용량 지원, 채널 권리 확인, 문의·철회 처리 및 중복 참여 방지를 위해 회원 식별자, 가입일, 로그인 방식, 계정 이름·이메일(제공된 경우), 휴대폰 번호, 등록한 유튜브·인스타그램 채널 주소와 동의·처리 이력을 이용합니다. 이름·이메일은 다시 입력하지 않습니다. 자동 문자 발송은 하지 않습니다.",
    "선정 전 신청 정보는 접수일부터 최대 90일 보관하며, 미선정·철회·기간 만료 시 불필요한 연락처와 채널 원문을 삭제합니다. 선정된 신청자의 휴대폰 번호는 지원 종료 또는 철회 시 삭제하고, 채널 링크는 홍보 이용 종료 또는 철회 시 삭제합니다. 선정자의 동의·처리 상세 이력은 지원 종료 후 1년까지 보관합니다. 중복 참여 확인용 회원 식별자·채널 주소 해시와 지급 연결 기록은 프로그램 운영 중 보관하며 모집 영구 종료 및 지원·이력 보관 기간 종료 후 삭제합니다. 법령에 따라 보관해야 하는 기록은 해당 기간 별도 보관합니다. 기존 가입 정보는 서비스 개인정보 처리방침을 따릅니다.",
    "동의를 거부할 수 있으며 거부 시 본 프로그램에는 참여할 수 없습니다. 일반 이지컷 이용에는 영향을 주지 않습니다. 열람·정정·삭제·처리정지·동의 철회는 easycut@easycut.co.kr로 요청할 수 있습니다. 법정 권리는 이 약정으로 제한되지 않습니다.",
  ] },
  { key: "disclosure", title: "채널 정보 공개·제공 동의", required: true, paragraphs: [
    "공개·제공 항목은 신청자가 등록한 채널 링크입니다. 신청용 계정 이름·이메일·휴대폰 번호는 공개하지 않습니다. 선정되지 않은 신청자의 채널 정보는 홍보에 사용하지 않습니다.",
    "목적은 이지컷 파트너 크리에이터 소개와 서비스 홍보입니다. 이지컷 홈페이지·공식 SNS·서비스 소개자료의 열람자에게 공개되며 인스타그램·페이스북·유튜브 유료 광고 제작·게재를 위해 해당 광고 플랫폼 운영자(Meta, Google)에 소재로 제공됩니다. 이용 기간은 선정 후 지원 시작일부터 1년이며 종료 시 아티룸이 관리하는 게시·광고 사용을 중단합니다.",
    "동의를 거부할 수 있으며 거부 시 본 프로그램에는 참여할 수 없습니다. 추가 수신자나 새로운 이용 목적·항목이 필요한 경우 별도 고지·동의를 진행합니다. 플랫폼 제공·국외 이전에 필요한 별도 고지 및 법적 요건은 실제 집행 전에 확인합니다.",
  ] },
  { key: "license", title: "채널 소개·유료 광고 이용약정", required: true, paragraphs: [
    "신청 내용을 검토해 함께할 크리에이터 10명을 선정합니다. 신청만으로 지원이 시작되거나 사용량이 지급되지는 않습니다. 선정된 분께 입력한 연락처로 개별 연락하며 지원 시작일을 안내합니다.",
    "등록한 채널 링크를 선정 후 지원 시작일부터 1년 동안 이지컷 파트너 크리에이터 소개 및 온라인 유료 광고에 비독점적으로 사용할 수 있도록 아티룸에 허락합니다. 매체는 이지컷 홈페이지·공식 SNS·서비스 소개자료와 인스타그램·페이스북·유튜브 유료 광고입니다. 실제 사용 전 채널 운영 권한과 소재 권리를 확인합니다. 영상·썸네일·후기 인용·얼굴·음성의 별도 활용에는 추가 허락이 필요합니다.",
    "지원 시작일, 1개월 후, 2개월 후 각 100분을 지원합니다. 월별 잔여량은 다음 회차 시작 시 만료되고 이월되지 않습니다. 마지막 회차는 지원 시작 3개월 후 만료됩니다. 한국 시간 기준 최초 지원 시작 날짜·시각을 유지하며 없는 날짜는 해당 월 말일로 보정합니다. 유료 요금제 변경이나 자동 결제는 없으며 지원 사용량 외 별도 소재 사용료는 지급하지 않습니다.",
    "홍보 이용약정은 1년입니다. 개인정보 동의 철회 등 법정 권리를 배제하지 않습니다. 종료 요청은 고객센터에서 확인·처리하며 기본 처리안은 홍보 중단, 미래 회차 취소, 이미 시작한 회차의 기존 만료일 유지입니다. 자동 위약금·환수는 없습니다. 문의·권리 행사: 아티룸 / easycut@easycut.co.kr.",
  ] },
] as const;

export type CreatorApplicationChannel = { platform: CreatorPlatform; channelUrl: string };
export function normalizeApplicationChannels(values: Record<CreatorPlatform, string>): CreatorApplicationChannel[] {
  const channels = (["youtube", "instagram"] as const).filter((platform) => values[platform].trim())
    .map((platform) => ({ platform, channelUrl: normalizeCreatorChannel(platform, values[platform]).channelUrl }));
  if (!channels.length) throw new Error("유튜브나 인스타그램 링크를 하나 이상 입력해 주세요.");
  return channels;
}
export function normalizeApplicationPhone(value: string) {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^01(?:0\d{8}|[16789]\d{7,8})$/.test(digits)) throw new Error("선정 결과를 받을 휴대폰 번호를 확인해 주세요.");
  return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}
export const creatorApplicationSchema = z.object({
  accountKey: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid(),
  channels: z.array(z.object({ platform: z.enum(["youtube", "instagram"]), channelUrl: z.string().trim().min(1).max(400) }).strict()).min(1).max(2)
    .refine((channels) => new Set(channels.map((item) => item.platform)).size === channels.length),
  phoneNumber: z.string().trim().min(1).max(20), ownsChannel: z.literal(true),
  termsVersion: z.literal(CREATOR_APPLICATION_TERMS_VERSION),
  consents: z.object({ collection: z.literal(true), disclosure: z.literal(true), license: z.literal(true) }).strict(),
}).strict();
export type CreatorApplicationInput = z.infer<typeof creatorApplicationSchema>;
export type CreatorApplication = {
  id: string; state: "pending_review" | "selected" | "rejected" | "withdrawn" | "expired";
  submittedAt: string; selectedAt: string | null; phoneNumber: string | null;
  channels: CreatorApplicationChannel[]; enrollmentId: string | null;
};
