export const editorRenderV4RolloutPercents = [0, 5, 25, 100] as const;
export const editorRenderV4AuditEntityId = "render-v4" as const;
export const editorRenderV4EmergencyStoppedAction =
  "editor_release.render_v4_emergency_stopped" as const;
export const editorRenderV4StoppedOnPromotionAction =
  "editor_release.render_v4_stopped_on_promotion" as const;
export const editorRenderV4StoppedForNewCandidateAction =
  "editor_release.render_v4_stopped_for_new_candidate" as const;
export const editorRenderV4ControlAuditActions = [
  editorRenderV4EmergencyStoppedAction,
  editorRenderV4StoppedOnPromotionAction,
  editorRenderV4StoppedForNewCandidateAction,
  "editor_release.render_v4_internal_enabled",
  "editor_release.render_v4_internal_disabled",
  "editor_release.render_v4_rollout_advanced",
] as const;

export type EditorRenderV4RolloutPercent =
  (typeof editorRenderV4RolloutPercents)[number];

export type EditorRenderV4PublicRolloutPercent = Exclude<
  EditorRenderV4RolloutPercent,
  0
>;

export function isEditorRenderV4RolloutPercent(
  value: number,
): value is EditorRenderV4RolloutPercent {
  return editorRenderV4RolloutPercents.includes(
    value as EditorRenderV4RolloutPercent,
  );
}

export function nextEditorRenderV4RolloutPercent(
  currentPercent: number,
  killSwitch: boolean,
): EditorRenderV4PublicRolloutPercent | null {
  if (!isEditorRenderV4RolloutPercent(currentPercent)) return null;
  if (killSwitch && currentPercent > 0) return null;
  if (currentPercent === 0) return 5;
  if (currentPercent === 5) return 25;
  if (currentPercent === 25) return 100;
  return null;
}

export function canEnableEditorRenderV4Internal(
  rolloutPercent: number,
  killSwitch: boolean,
  latestTransition: string | null,
  latestTransitionReleaseId: string | null,
  candidateReleaseId: string,
) {
  const stoppedCandidate = latestTransition
    === editorRenderV4EmergencyStoppedAction
    && latestTransitionReleaseId === candidateReleaseId;
  return isEditorRenderV4RolloutPercent(rolloutPercent)
    && (
      !killSwitch
      || (
        rolloutPercent === 0
        && !stoppedCandidate
      )
    );
}

export function isEditorRenderV4EmergencyForRelease(
  latestTransition: string | null,
  latestTransitionReleaseId: string | null,
  releaseId: string,
) {
  return latestTransition === editorRenderV4EmergencyStoppedAction
    && latestTransitionReleaseId === releaseId;
}
