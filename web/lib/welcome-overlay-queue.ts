export const welcomeOverlayStages = [
  "onboarding",
  "existing-welcome",
  "shorts-event",
  "sidebar-navigation",
  "feedback",
  "done",
] as const;

export type WelcomeOverlayStage = (typeof welcomeOverlayStages)[number];

export function nextWelcomeOverlayStage(
  stage: Exclude<WelcomeOverlayStage, "done">,
): WelcomeOverlayStage {
  const index = welcomeOverlayStages.indexOf(stage);
  return welcomeOverlayStages[index + 1] ?? "done";
}
