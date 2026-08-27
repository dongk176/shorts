import { describe, expect, it } from "vitest";
import {
  canEnableEditorRenderV4Internal,
  editorRenderV4AuditEntityId,
  editorRenderV4ControlAuditActions,
  editorRenderV4EmergencyStoppedAction,
  editorRenderV4StoppedForNewCandidateAction,
  editorRenderV4StoppedOnPromotionAction,
  isEditorRenderV4EmergencyForRelease,
  isEditorRenderV4RolloutPercent,
  nextEditorRenderV4RolloutPercent,
} from "./editor-render-v4-rollout-control";

describe("editor render v4 rollout control", () => {
  it("uses one exact global audit stream for every rollout transition", () => {
    expect(editorRenderV4AuditEntityId).toBe("render-v4");
    expect(editorRenderV4ControlAuditActions).toHaveLength(6);
    expect(editorRenderV4ControlAuditActions).toContain(
      editorRenderV4EmergencyStoppedAction,
    );
    expect(editorRenderV4ControlAuditActions).toContain(
      editorRenderV4StoppedOnPromotionAction,
    );
    expect(editorRenderV4ControlAuditActions).toContain(
      editorRenderV4StoppedForNewCandidateAction,
    );
  });

  it("admits only the reviewed rollout percentages", () => {
    for (const value of [0, 5, 25, 100]) {
      expect(isEditorRenderV4RolloutPercent(value)).toBe(true);
    }
    for (const value of [-1, 1, 10, 50, 101]) {
      expect(isEditorRenderV4RolloutPercent(value)).toBe(false);
    }
  });

  it("advances public rollout only through 0 to 5 to 25 to 100", () => {
    expect(nextEditorRenderV4RolloutPercent(0, true)).toBe(5);
    expect(nextEditorRenderV4RolloutPercent(0, false)).toBe(5);
    expect(nextEditorRenderV4RolloutPercent(5, false)).toBe(25);
    expect(nextEditorRenderV4RolloutPercent(25, false)).toBe(100);
    expect(nextEditorRenderV4RolloutPercent(100, false)).toBeNull();
    expect(nextEditorRenderV4RolloutPercent(50, false)).toBeNull();
  });

  it("keeps every emergency-stopped reviewed percentage closed", () => {
    for (const percent of [5, 25, 100]) {
      expect(nextEditorRenderV4RolloutPercent(percent, true)).toBeNull();
    }
  });

  it("blocks zero-percent emergency reuse but permits a different verified release", () => {
    expect(canEnableEditorRenderV4Internal(
      0,
      true,
      editorRenderV4EmergencyStoppedAction,
      "release-a",
      "release-a",
    )).toBe(false);
    expect(canEnableEditorRenderV4Internal(
      0,
      true,
      editorRenderV4StoppedOnPromotionAction,
      "release-a",
      "release-a",
    )).toBe(true);
    expect(canEnableEditorRenderV4Internal(
      0,
      true,
      editorRenderV4EmergencyStoppedAction,
      "release-old",
      "release-new",
    )).toBe(true);
    expect(canEnableEditorRenderV4Internal(0, false, null, null, "release-a"))
      .toBe(true);
    expect(canEnableEditorRenderV4Internal(100, false, null, null, "release-a"))
      .toBe(true);
    expect(canEnableEditorRenderV4Internal(5, true, null, null, "release-a"))
      .toBe(false);
    expect(canEnableEditorRenderV4Internal(25, true, null, null, "release-a"))
      .toBe(false);
    expect(canEnableEditorRenderV4Internal(100, true, null, null, "release-a"))
      .toBe(false);
    expect(isEditorRenderV4EmergencyForRelease(
      editorRenderV4EmergencyStoppedAction,
      "release-a",
      "release-a",
    )).toBe(true);
    expect(isEditorRenderV4EmergencyForRelease(
      editorRenderV4EmergencyStoppedAction,
      "release-old",
      "release-new",
    )).toBe(false);
  });
});
