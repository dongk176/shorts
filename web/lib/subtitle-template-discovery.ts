import type { SubtitleTemplateSelectionId } from "@/lib/subtitle-templates";

export const SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY =
  "easycut:subtitle-template-used:v1";

export const SUBTITLE_TEMPLATE_DISCOVERY_DEFAULT_ID: SubtitleTemplateSelectionId =
  "highlight";

export const subtitleTemplateDiscoverySteps = [
  {
    id: "discover",
    eyebrow: "새로운 자막 스타일",
    title: "자막 템플릿이 생겼어요!",
    description:
      "중요한 단어를 자동으로 강조해 쇼츠의 몰입도를 높여 보세요. 자막 위치도 영상에 맞게 바로 고를 수 있어요.",
    targetSelector: null,
  },
] as const;

export function markSubtitleTemplateUsed() {
  try {
    window.localStorage.setItem(SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY, "1");
  } catch {
    // Local storage is optional. Server-side usage history remains authoritative.
  }
}
