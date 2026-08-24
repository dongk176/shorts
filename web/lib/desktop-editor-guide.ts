export const DESKTOP_EDITOR_GUIDE_STORAGE_KEY = "easycut:desktop-editor-guide-dismissed:v1";
export const OVERLAY_DESKTOP_EDITOR_GUIDE_STORAGE_KEY = "easycut:overlay-editor-guide-dismissed:v9";

export const DESKTOP_EDITOR_GUIDE_MEDIA_QUERY = [
  "(min-width: 921px)",
  "(hover: hover)",
  "(pointer: fine)",
].join(" and ");

export type DesktopEditorGuideStep = {
  id: string;
  feature: "workspace" | "overlay-actions" | "video-split" | "sidebar" | "timeline" | "history" | "save" | "range" | "comments" | "complete";
  eyebrow: string;
  title: string;
  description: string;
  targetSelector: string | null;
  placement?: "auto" | "right" | "left" | "above" | "below";
};

export const desktopEditorGuideSteps: readonly DesktopEditorGuideStep[] = [
  {
    id: "sidebar-tools",
    feature: "sidebar",
    eyebrow: "스타일 설정",
    title: "왼쪽 메뉴에서 모양을 조정하세요",
    description: "왼쪽 도구 모음에서 원하는 설정을 하나 골라 세부 사이드바를 열고, 글꼴과 색상·배경·템플릿을 한곳에서 조정하세요.",
    targetSelector: '[data-editor-guide="sidebar-tools"]',
    placement: "right",
  },
  {
    id: "overlay-actions",
    feature: "overlay-actions",
    eyebrow: "오버레이 추가",
    title: "댓글과 텍스트를 추가하세요",
    description: "‘+ 댓글’은 새 댓글 오버레이를, ‘+ 텍스트’는 자유롭게 꾸밀 수 있는 문구를 영상 위에 추가합니다.",
    targetSelector: '[data-editor-guide="overlay-actions"]',
    placement: "above",
  },
  {
    id: "preview-canvas",
    feature: "workspace",
    eyebrow: "직접 편집",
    title: "화면에서 요소를 바로 선택하세요",
    description: "미리보기의 영상과 오버레이를 클릭해 선택하고 끌어서 옮기세요. 제목과 추가 텍스트는 더블클릭하면 바로 수정할 수 있어요.",
    targetSelector: '[data-editor-guide="preview-canvas"]',
  },
  {
    id: "editor-timeline",
    feature: "timeline",
    eyebrow: "타임라인",
    title: "아래에서 영상과 오버레이 길이를 맞추세요",
    description: "영상 조각과 댓글·추가 텍스트의 바를 선택하세요. 바를 끌어 옮기고 양끝 핸들로 노출 구간을 조정할 수 있어요.",
    targetSelector: '[data-editor-guide="editor-timeline"]',
    placement: "above",
  },
  {
    id: "video-split",
    feature: "video-split",
    eyebrow: "영상 분할",
    title: "필요한 지점에서 영상을 나누세요",
    description: "재생 위치에서 ‘분할’을 누르면 영상이 두 조각으로 나뉩니다. 필요 없는 조각을 선택해 따로 삭제할 수 있어요.",
    targetSelector: '[data-editor-guide="video-split"]',
    placement: "above",
  },
  {
    id: "editor-history",
    feature: "history",
    eyebrow: "편집 기록",
    title: "실수해도 바로 되돌릴 수 있어요",
    description: "상단 버튼이나 ⌘Z·Ctrl+Z로 되돌리고, Shift를 함께 누르면 앞으로 갈 수 있어요.",
    targetSelector: '[data-editor-guide="editor-history"]',
    placement: "below",
  },
  {
    id: "editor-save",
    feature: "save",
    eyebrow: "편집 저장",
    title: "편집이 끝나면 여기서 저장하세요",
    description: "현재 로컬 테스트에서는 저장이 잠겨 있어 변경 내용이 서버에 저장되지 않습니다. 실제 렌더링이 연결되면 이 버튼에서 편집한 영상을 저장하게 됩니다.",
    targetSelector: '[data-editor-guide="editor-save"]',
    placement: "below",
  },
  {
    id: "complete",
    feature: "complete",
    eyebrow: "편집 가이드 완료",
    title: "이제 직접 편집해 보세요",
    description: "왼쪽에서 스타일을 고르고, 화면에서 요소를 편집하고, 아래 타임라인에서 시간을 다듬으면 됩니다.",
    targetSelector: null,
  },
];

export const legacyDesktopEditorGuideSteps: readonly DesktopEditorGuideStep[] = [
  {
    id: "range-handles",
    feature: "range",
    eyebrow: "영상 구간 조정",
    title: "양쪽 핸들로 시작과 끝을 맞춰 보세요",
    description: "타임라인 양끝의 핸들을 드래그하면 편집 가능한 범위 안에서 영상의 시작점과 끝점을 세밀하게 조정할 수 있어요.",
    targetSelector: '[data-editor-guide="range-handles"]',
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
  overlayPreviewEnabled = true,
  editorSaveEnabled = false,
}: {
  rangeControlsAvailable: boolean;
  commentControlsAvailable: boolean;
  overlayPreviewEnabled?: boolean;
  editorSaveEnabled?: boolean;
}) {
  if (overlayPreviewEnabled) {
    return desktopEditorGuideSteps.filter((step) => (
      (
        step.feature !== "timeline"
        || rangeControlsAvailable
        || commentControlsAvailable
      )
      && (
        step.feature !== "video-split"
        || rangeControlsAvailable
      )
    )).map((step) => (
      step.feature === "save" && editorSaveEnabled
        ? {
            ...step,
            description: "‘영상에 적용’을 누르면 편집한 내용으로 재렌더링이 시작됩니다. 완료되면 프로젝트에서 새 영상을 확인하고 다운로드할 수 있어요.",
          }
        : step
    ));
  }
  return legacyDesktopEditorGuideSteps.filter((step) => (
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
