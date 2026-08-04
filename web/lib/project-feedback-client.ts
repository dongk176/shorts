export const PROJECT_FEEDBACK_STATUS_REFRESH_EVENT =
  "easycut:project-feedback-status-refresh";

export const PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY =
  "easycut:project-feedback:completed-project-viewed";

type ProjectFeedbackStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ProjectFeedbackProjectViewedMarker = {
  version: 1;
  projectNumber: number;
  viewedAt: string;
};

function browserSessionStorage(): ProjectFeedbackStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isProjectFeedbackProjectRoute(pathname: string): boolean {
  return /^\/projects\/\d+(?:\/|$)/.test(pathname);
}

export function markCompletedProjectViewedForFeedback(
  projectNumber: number,
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
) {
  if (!storage || !Number.isSafeInteger(projectNumber) || projectNumber < 1) return;
  const marker: ProjectFeedbackProjectViewedMarker = {
    version: 1,
    projectNumber,
    viewedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(
      PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY,
      JSON.stringify(marker),
    );
  } catch {
    // 피드백 표시는 핵심 프로젝트 흐름을 방해하지 않는다.
  }
}

export function hasCompletedProjectViewedForFeedback(
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<ProjectFeedbackProjectViewedMarker>;
    return marker.version === 1
      && Number.isSafeInteger(marker.projectNumber)
      && Number(marker.projectNumber) > 0
      && typeof marker.viewedAt === "string";
  } catch {
    return false;
  }
}

export function clearCompletedProjectViewedForFeedback(
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
) {
  if (!storage) return;
  try {
    storage.removeItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY);
  } catch {
    // 피드백 표시는 핵심 프로젝트 흐름을 방해하지 않는다.
  }
}

export function publishProjectFeedbackStatusRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT));
}
