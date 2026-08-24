export const SUBTITLE_POSITION_GUIDE_STORAGE_KEY =
  "easycut:subtitle-position-guide-dismissed:v1";

export const subtitlePositionGuideSteps = [
  {
    id: "lower",
    eyebrow: "자막 위치 · 하단",
    title: "원본에 자막이 없다면 하단",
    description:
      "대사가 계속 이어지거나 원본 영상에 자막이 없을 때 좋아요. 화면을 덜 가리면서 내용을 안정적으로 전달합니다.",
    targetSelector: '[data-subtitle-position-guide="lower"]',
    placement: "above" as const,
    scrollBlock: "center" as const,
  },
  {
    id: "center",
    eyebrow: "자막 위치 · 중앙",
    title: "짧은 대사와 몰입형 장면은 중앙",
    description:
      "자막이 간헐적으로 나오거나 시선을 대사에 모으고 싶을 때 좋아요. 얼굴이나 핵심 장면을 가리지 않는지 미리보기로 확인하세요.",
    targetSelector: '[data-subtitle-position-guide="center"]',
    placement: "above" as const,
    scrollBlock: "center" as const,
  },
  {
    id: "complete",
    eyebrow: "자막 위치 선택 완료",
    title: "선택한 위치가 그대로 렌더링돼요",
    description:
      "하단과 중앙을 눌러 영상 비율별 위치를 비교하세요. 템플릿 미리보기와 실제 영상에 같은 위치가 적용됩니다.",
    targetSelector: null,
  },
] as const;
