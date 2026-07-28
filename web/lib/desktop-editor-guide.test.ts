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

  it("ends with the completion step after all four editing hints", () => {
    expect(desktopEditorGuideSteps.map((step) => step.id)).toEqual([
      "range-handles",
      "reset-range",
      "add-comment",
      "edit-comment",
      "complete",
    ]);
    expect(desktopEditorGuideSteps.at(-1)?.targetSelector).toBeNull();
  });

  it("skips controls that are unavailable for the current editor", () => {
    expect(desktopEditorGuideStepsFor({
      rangeControlsAvailable: false,
      commentControlsAvailable: true,
    }).map((step) => step.id)).toEqual([
      "add-comment",
      "edit-comment",
      "complete",
    ]);
    expect(desktopEditorGuideStepsFor({
      rangeControlsAvailable: true,
      commentControlsAvailable: false,
    }).map((step) => step.id)).toEqual([
      "range-handles",
      "reset-range",
      "complete",
    ]);
  });

  it("clamps the active step when a template change removes guide steps", () => {
    expect(clampDesktopEditorGuideStepIndex(3, 5)).toBe(3);
    expect(clampDesktopEditorGuideStepIndex(3, 3)).toBe(2);
    expect(clampDesktopEditorGuideStepIndex(4, 1)).toBe(0);
  });
});
