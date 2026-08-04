export const welcomeOverlayStages = [
  "onboarding",
  "existing-welcome",
  "sidebar-navigation",
  "shorts-event",
  "feedback",
  "done",
] as const;

export type WelcomeOverlayStage = (typeof welcomeOverlayStages)[number];

const retiredWelcomeOverlayStages = new Set<WelcomeOverlayStage>([
  "shorts-event",
]);

export function nextWelcomeOverlayStage(
  stage: Exclude<WelcomeOverlayStage, "done">,
): WelcomeOverlayStage {
  let index = welcomeOverlayStages.indexOf(stage) + 1;
  while (index < welcomeOverlayStages.length) {
    const nextStage = welcomeOverlayStages[index] ?? "done";
    if (!retiredWelcomeOverlayStages.has(nextStage)) return nextStage;
    index += 1;
  }
  return "done";
}
