export const DESKTOP_EDITOR_GUIDE_STORAGE_KEY = "easycut:desktop-editor-guide-dismissed:v1";

export const DESKTOP_EDITOR_GUIDE_MEDIA_QUERY = [
  "(min-width: 921px)",
  "(hover: hover)",
  "(pointer: fine)",
].join(" and ");

export type DesktopEditorGuideStep = {
  id: string;
  feature: "range" | "comments" | "complete";
  eyebrow: string;
  title: string;
  description: string;
  targetSelector: string | null;
};

export const desktopEditorGuideSteps: readonly DesktopEditorGuideStep[] = [
  {
    id: "range-handles",
    feature: "range",
    eyebrow: "영상 구간 조정",
    title: "양쪽 핸들로 시작과 끝을 맞춰 보세요",
    description: "타임라인 양끝의 핸들을 드래그하면 편집 가능한 범위 안에서 영상의 시작점과 끝점을 세밀하게 조정할 수 있어요.",
    targetSelector: '[data-editor-guide="range-handles"]',
  },
  {
    id: "reset-range",
    feature: "range",
    eyebrow: "빠른 복구",
    title: "언제든 처음 구간으로 되돌릴 수 있어요",
    description: "조정한 구간이 마음에 들지 않으면 ‘원본으로 되돌리기’를 눌러 편집을 시작했을 때의 구간으로 복구하세요.",
    targetSelector: '[data-editor-guide="reset-range"]',
  },
  {
    id: "add-comment",
    feature: "comments",
    eyebrow: "댓글 추가",
    title: "원하는 지점에 댓글을 더해 보세요",
    description: "‘+ 댓글’을 누르면 새 댓글이 생겨요. 댓글 타임라인에서 위치와 노출 길이도 함께 조절할 수 있습니다.",
    targetSelector: '[data-editor-guide="add-comment"]',
  },
  {
    id: "edit-comment",
    feature: "comments",
    eyebrow: "댓글 내용 수정",
    title: "댓글을 더블클릭하면 바로 수정할 수 있어요",
    description: "댓글 바를 더블클릭해 문구를 바꾸세요. 바 전체를 드래그하면 위치를, 양끝 핸들을 드래그하면 노출 시간을 조정할 수 있어요.",
    targetSelector: '[data-editor-guide="comment-item"]',
  },
  {
    id: "complete",
    feature: "complete",
    eyebrow: "편집 가이드 완료",
    title: "이제 직접 편집해 보세요",
    description: "확인을 누르면 다음에 편집 화면에 들어왔을 때 가이드를 다시 볼 수 있어요. 더 이상 필요하지 않다면 다시 보지 않기를 선택해 주세요.",
    targetSelector: null,
  },
];

export function desktopEditorGuideStepsFor({
  rangeControlsAvailable,
  commentControlsAvailable,
}: {
  rangeControlsAvailable: boolean;
  commentControlsAvailable: boolean;
}) {
  return desktopEditorGuideSteps.filter((step) => (
    step.feature === "complete"
    || (step.feature === "range" && rangeControlsAvailable)
    || (step.feature === "comments" && commentControlsAvailable)
  ));
}

export function clampDesktopEditorGuideStepIndex(stepIndex: number, stepCount: number) {
  return Math.max(0, Math.min(stepIndex, Math.max(0, stepCount - 1)));
}

export function shouldShowDesktopEditorGuide({
  enabled,
  desktopMediaMatches,
  dismissedValue,
}: {
  enabled: boolean;
  desktopMediaMatches: boolean;
  dismissedValue: string | null;
}) {
  return enabled && desktopMediaMatches && dismissedValue !== "1";
}
