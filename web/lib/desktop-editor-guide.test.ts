import { describe, expect, it } from "vitest";
import {
  clampDesktopEditorGuideStepIndex,
  desktopEditorGuideStepsFor,
  desktopEditorGuideSteps,
  shouldShowDesktopEditorGuide,
} from "./desktop-editor-guide";

describe("desktop editor guide", () => {
  it("only opens for an enabled desktop editor that has not been dismissed", () => {
    expect(shouldShowDesktopEditorGuide({
      enabled: true,
      desktopMediaMatches: true,
      dismissedValue: null,
    })).toBe(true);
    expect(shouldShowDesktopEditorGuide({
      enabled: false,
      desktopMediaMatches: true,
      dismissedValue: null,
    })).toBe(false);
    expect(shouldShowDesktopEditorGuide({
      enabled: true,
      desktopMediaMatches: false,
      dismissedValue: null,
    })).toBe(false);
    expect(shouldShowDesktopEditorGuide({
      enabled: true,
      desktopMediaMatches: true,
      dismissedValue: "1",
    })).toBe(false);
  });

  it("groups the overlay editor into concise editing hints", () => {
    expect(desktopEditorGuideSteps.map((step) => step.id)).toEqual([
      "sidebar-tools",
      "overlay-actions",
      "preview-canvas",
      "editor-timeline",
      "video-split",
      "editor-history",
      "editor-save",
      "complete",
    ]);
    expect(desktopEditorGuideSteps.at(-1)?.targetSelector).toBeNull();
    expect(
      desktopEditorGuideSteps.find((step) => step.id === "sidebar-tools")
        ?.placement,
    ).toBe("right");
    expect(
      desktopEditorGuideSteps.find((step) => step.id === "overlay-actions")
        ?.placement,
    ).toBe("above");
    expect(
      desktopEditorGuideSteps.find((step) => step.id === "video-split")
        ?.placement,
    ).toBe("above");
    expect(desktopEditorGuideSteps.at(-1)?.placement).toBeUndefined();
  });

  it("explains the left sidebar once and skips only an unavailable timeline", () => {
    expect(desktopEditorGuideStepsFor({
      rangeControlsAvailable: false,
      commentControlsAvailable: true,
    }).map((step) => step.id)).toEqual([
      "sidebar-tools",
      "overlay-actions",
      "preview-canvas",
      "editor-timeline",
      "editor-history",
      "editor-save",
      "complete",
    ]);
    expect(desktopEditorGuideStepsFor({
      rangeControlsAvailable: false,
      commentControlsAvailable: false,
    }).map((step) => step.id)).toEqual([
      "sidebar-tools",
      "overlay-actions",
      "preview-canvas",
      "editor-history",
      "editor-save",
      "complete",
    ]);
  });

  it("preserves the production editor guide while the overlay preview is off", () => {
    expect(desktopEditorGuideStepsFor({
      rangeControlsAvailable: true,
      commentControlsAvailable: false,
      overlayPreviewEnabled: false,
    }).map((step) => step.id)).toEqual([
      "range-handles",
      "complete",
    ]);
  });

  it("explains real rendering only when saving is enabled", () => {
    const enabledSave = desktopEditorGuideStepsFor({
      rangeControlsAvailable: true,
      commentControlsAvailable: true,
      editorSaveEnabled: true,
    }).find((step) => step.feature === "save");
    const lockedSave = desktopEditorGuideStepsFor({
      rangeControlsAvailable: true,
      commentControlsAvailable: true,
      editorSaveEnabled: false,
    }).find((step) => step.feature === "save");

    expect(enabledSave?.description).toContain("재렌더링이 시작");
    expect(lockedSave?.description).toContain("저장이 잠겨");
  });

  it("clamps the active step when a template change removes guide steps", () => {
    expect(clampDesktopEditorGuideStepIndex(3, 5)).toBe(3);
    expect(clampDesktopEditorGuideStepIndex(3, 3)).toBe(2);
    expect(clampDesktopEditorGuideStepIndex(4, 1)).toBe(0);
  });
});
