export const PROJECT_ACTION_GUIDE_STORAGE_KEY = "easycut:project-action-guide-dismissed:v1";

export type ProjectActionGuideStep = {
  id: string;
  feature: "edit" | "download" | "bulk-download" | "back" | "complete";
  eyebrow: string;
  title: string;
  description: string;
  targetSelector: string | null;
};

export const projectActionGuideSteps: readonly ProjectActionGuideStep[] = [
  {
    id: "edit",
    feature: "edit",
    eyebrow: "쇼츠 편집",
    title: "완성된 쇼츠를 내 스타일로 다듬어 보세요",
    description: "‘편집하기’를 누르면 새 탭에서 제목, 자막, 템플릿과 영상 구간을 조정한 뒤 다시 렌더링할 수 있어요.",
    targetSelector: '[data-project-guide="edit"]',
  },
  {
    id: "download",
    feature: "download",
    eyebrow: "개별 저장",
    title: "필요한 쇼츠만 바로 다운로드하세요",
    description: "각 쇼츠 아래의 ‘다운로드’를 누르면 해당 영상 하나만 기기에 저장할 수 있어요.",
    targetSelector: '[data-project-guide="download"]',
  },
  {
    id: "bulk-download",
    feature: "bulk-download",
    eyebrow: "한 번에 저장",
    title: "완성된 쇼츠를 한꺼번에 받을 수 있어요",
    description: "상단 버튼을 누르면 다운로드 가능한 쇼츠가 ZIP 파일 하나로 저장돼요. 압축을 풀면 각 영상을 사용할 수 있어요.",
    targetSelector: '[data-project-guide="bulk-download"]',
  },
  {
    id: "back",
    feature: "back",
    eyebrow: "프로젝트 목록",
    title: "다른 프로젝트로 돌아갈 수 있어요",
    description: "왼쪽 위 프로젝트 경로를 누르면 지금까지 만든 프로젝트 목록으로 돌아갑니다.",
    targetSelector: '[data-project-guide="back"]',
  },
  {
    id: "complete",
    feature: "complete",
    eyebrow: "프로젝트 가이드 완료",
    title: "이제 완성된 쇼츠를 활용해 보세요",
    description: "안내를 닫으면 자동으로 다시 표시되지 않아요. 이제 직접 편집해 보세요.",
    targetSelector: null,
  },
];

export function projectActionGuideStepsFor({
  editAvailable,
  downloadAvailable,
  bulkDownloadAvailable,
}: {
  editAvailable: boolean;
  downloadAvailable: boolean;
  bulkDownloadAvailable: boolean;
}) {
  return projectActionGuideSteps.filter((step) => (
    step.feature === "back"
    || step.feature === "complete"
    || (step.feature === "edit" && editAvailable)
    || (step.feature === "download" && downloadAvailable)
    || (step.feature === "bulk-download" && bulkDownloadAvailable)
  ));
}
