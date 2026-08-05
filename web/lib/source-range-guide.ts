export const SOURCE_RANGE_GUIDE_STORAGE_KEY = "easycut:source-range-guide-dismissed:v1";

export const sourceRangeGuideSteps = [
  {
    id: "start",
    eyebrow: "구간 선택 · 시작",
    title: "시작점을 정하세요",
    description: "왼쪽 손잡이를 움직이거나 시작 시각을 입력해 분석을 시작할 지점을 정하세요.",
    targetSelector: '[data-source-range-guide="start"]',
    placement: "above" as const,
  },
  {
    id: "end",
    eyebrow: "구간 선택 · 종료",
    title: "끝점을 정하세요",
    description: "오른쪽 손잡이를 움직이거나 종료 시각을 입력해 분석을 마칠 지점을 정하세요. 한 번에 최대 60분까지 선택할 수 있어요.",
    targetSelector: '[data-source-range-guide="end"]',
    placement: "above" as const,
  },
  {
    id: "usage",
    eyebrow: "사용량 안내",
    title: "선택한 길이만큼만 차감돼요",
    description: "원본 영상 전체가 아니라 선택한 구간의 길이만큼 사용량이 차감됩니다. 예상 쇼츠 수도 선택한 길이를 기준으로 계산돼요.",
    targetSelector: '[data-source-range-guide="usage"]',
    placement: "below" as const,
  },
  {
    id: "complete",
    eyebrow: "구간 선택 가이드 완료",
    title: "원하는 부분만 쇼츠로 만들어 보세요",
    description: "시작점과 끝점을 맞춘 뒤 선택 시간과 차감 시간을 확인하고 쇼츠 생성을 시작하면 됩니다.",
    targetSelector: null,
  },
] as const;
