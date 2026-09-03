import { describe, expect, it } from "vitest";
import {
  CURRENT_PRESET_TEMPLATE_SNAPSHOT,
  resolveEditedTemplateSelection,
} from "./edit-template-selection";

describe("edited template selection", () => {
  it("keeps the existing snapshot when the editor did not explicitly change templates", () => {
    expect(resolveEditedTemplateSelection({
      existing: {
        templateId: "dark-red",
        customTemplateId: null,
        templateSnapshot: null,
      },
      requestedTemplateId: "dark-red",
    })).toEqual({
      customTemplateId: null,
      templateSnapshot: null,
    });
  });

  it("uses the current preset layout when switching presets", () => {
    expect(resolveEditedTemplateSelection({
      existing: {
        templateId: "dark-red",
        customTemplateId: null,
        templateSnapshot: { presetVersion: 2 },
      },
      requestedTemplateId: "comment-capture",
    })).toEqual({
      customTemplateId: null,
      templateSnapshot: CURRENT_PRESET_TEMPLATE_SNAPSHOT,
    });
  });

  it("keeps a built-in subtitle layout for title-only edits", () => {
    const templateSnapshot = {
      presetVersion: 3,
      config: { schemaVersion: 5, title: { y: 295 } },
    };
    expect(resolveEditedTemplateSelection({
      existing: {
        templateId: "dark-minimal",
        customTemplateId: null,
        templateSnapshot,
      },
      requestedTemplateId: "dark-minimal",
      requestedCustomTemplateId: null,
      templateSelectionTouched: false,
    })).toEqual({
      customTemplateId: null,
      templateSnapshot,
    });
    expect(resolveEditedTemplateSelection({
      existing: {
        templateId: "dark-minimal",
        customTemplateId: null,
        templateSnapshot,
      },
      requestedTemplateId: "dark-minimal",
      requestedCustomTemplateId: null,
      templateSelectionTouched: true,
    })).toEqual({
      customTemplateId: null,
      templateSnapshot: CURRENT_PRESET_TEMPLATE_SNAPSHOT,
    });
  });

  it("clears a custom template when its base preset is explicitly selected", () => {
    expect(resolveEditedTemplateSelection({
      existing: {
        templateId: "comment-capture",
        customTemplateId: "06ca1cf2-adfe-4011-9d1a-f5514dfc6c43",
        templateSnapshot: { config: { schemaVersion: 4 } },
      },
      requestedTemplateId: "comment-capture",
      requestedCustomTemplateId: null,
    })).toEqual({
      customTemplateId: null,
      templateSnapshot: CURRENT_PRESET_TEMPLATE_SNAPSHOT,
    });
  });

  it("preserves only the custom template already attached to the short", () => {
    const existing = {
      templateId: "paper" as const,
      customTemplateId: "06ca1cf2-adfe-4011-9d1a-f5514dfc6c43",
      templateSnapshot: { id: "06ca1cf2-adfe-4011-9d1a-f5514dfc6c43" },
    };
    expect(resolveEditedTemplateSelection({
      existing,
      requestedTemplateId: "paper",
      requestedCustomTemplateId: existing.customTemplateId,
    })).toEqual({
      customTemplateId: existing.customTemplateId,
      templateSnapshot: existing.templateSnapshot,
    });
    expect(resolveEditedTemplateSelection({
      existing,
      requestedTemplateId: "paper",
      requestedCustomTemplateId: "caaf87e0-54c0-4d91-a5a1-713428f4a6b2",
    })).toBeNull();
  });
});
