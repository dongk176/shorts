export const PROJECT_FEEDBACK_STATUS_REFRESH_EVENT =
  "easycut:project-feedback-status-refresh";

export function publishProjectFeedbackStatusRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT));
}
