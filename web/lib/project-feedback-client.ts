export const PROJECT_FEEDBACK_STATUS_REFRESH_EVENT =
  "easycut:project-feedback-status-refresh";

export const PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY =
  "easycut:project-feedback:completed-project-viewed";

export const PROJECT_FEEDBACK_VIEW_TTL_MS = 30 * 60 * 1000;
const DEFERRED_KEY = "easycut:project-feedback:deferred";
const DEFERRED_TTL_MS = 24 * 60 * 60 * 1000;

type ProjectFeedbackStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ProjectFeedbackProjectViewedMarker = {
  version: 2;
  accountId: string;
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
  accountId: string,
  projectNumber: number,
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
) {
  if (!storage || !accountId || !Number.isSafeInteger(projectNumber) || projectNumber < 1) return;
  if (isFeedbackDeferred(accountId, storage)) return;
  const marker: ProjectFeedbackProjectViewedMarker = {
    version: 2,
    accountId,
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
  accountId: string,
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
): boolean {
  if (!storage || !accountId) return false;
  try {
    const raw = storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<ProjectFeedbackProjectViewedMarker> | null;
    const age = typeof marker?.viewedAt === "string"
      ? Date.now() - Date.parse(marker.viewedAt)
      : Number.NaN;
    const valid = marker?.version === 2
      && marker.accountId === accountId
      && Number.isSafeInteger(marker.projectNumber)
      && Number(marker.projectNumber) > 0
      && age >= 0 && age < PROJECT_FEEDBACK_VIEW_TTL_MS;
    if (!valid) clearCompletedProjectViewedForFeedback(storage);
    return valid && !isFeedbackDeferred(accountId, storage);
  } catch {
    clearCompletedProjectViewedForFeedback(storage);
    return false;
  }
}

function isFeedbackDeferred(accountId: string, storage: ProjectFeedbackStorage): boolean {
  try {
    const value = JSON.parse(storage.getItem(DEFERRED_KEY) || "null");
    const age = Date.now() - Number(value?.deferredAt);
    return value?.accountId === accountId && age >= 0 && age < DEFERRED_TTL_MS;
  } catch {
    return false;
  }
}

export function deferProjectFeedback(
  accountId: string,
  storage: ProjectFeedbackStorage | null = browserSessionStorage(),
) {
  clearCompletedProjectViewedForFeedback(storage);
  if (!storage || !accountId) return;
  try {
    storage.setItem(DEFERRED_KEY, JSON.stringify({ accountId, deferredAt: Date.now() }));
  } catch {
    // Dismissal still closes the dialog when browser storage is unavailable.
  }
}

// Count playback progress only while a ready video is playing in a visible tab.
// Pauses, background time and seeks must not turn loading into a result view.
export function createProjectFeedbackPlaybackTracker() {
  let previousTime: number | null = null;
  let playedSeconds = 0;
  return (currentTime: number, active: boolean): boolean => {
    if (!active || !Number.isFinite(currentTime) || currentTime < 0) {
      previousTime = null;
      return false;
    }
    const delta = previousTime === null ? 0 : currentTime - previousTime;
    previousTime = currentTime;
    if (delta > 0 && delta <= 1.5) playedSeconds += delta;
    return playedSeconds >= 3;
  };
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
