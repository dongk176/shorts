import type { SiteLocale } from "@/lib/i18n/config";
import { createYoutubeText } from "./i18n";
export const privacyValues = ["private", "unlisted", "public"] as const;
export type Privacy = typeof privacyValues[number];
export const privacyLabels: Record<Privacy, string> = { private: "비공개", unlisted: "일부 공개", public: "공개" };
export const privacyDescriptions: Record<Privacy, string> = {
  private: "본인과 YouTube에서 별도로 허용한 사용자만 볼 수 있습니다.",
  unlisted: "영상 링크를 아는 누구나 볼 수 있습니다.",
  public: "누구나 볼 수 있으며 검색과 채널에 표시될 수 있습니다.",
};
export function isPrivacy(value: unknown): value is Privacy {
  return privacyValues.includes(value as Privacy);
}
export function privacyResult(requested: Privacy, actual: Privacy | null, locale: SiteLocale = "ko") {
  const yt=createYoutubeText(locale);
  if (!actual) return yt("YouTube 공개 범위 확인 전");
  return requested === actual ? yt("YouTube 확인: {actual}",{actual:yt(privacyLabels[actual])}) : yt("요청: {requested} · YouTube 확인: {actual}",{requested:yt(privacyLabels[requested]),actual:yt(privacyLabels[actual])});
}
