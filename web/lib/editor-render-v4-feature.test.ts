import { afterEach, describe, expect, it } from "vitest";
import { isEditorRenderSpecV4Enabled } from "./editor-render-v4-feature";

const originalValue = process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED;

afterEach(() => {
  if (originalValue == null) {
    delete process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED = originalValue;
  }
});

describe("editor render v4 feature gate", () => {
  it("is disabled when the public release flag is missing", () => {
    delete process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED;
    expect(isEditorRenderSpecV4Enabled()).toBe(false);
  });

  it("accepts only the exact released value", () => {
    for (const value of ["TRUE", "1", "yes", " true", "true "]) {
      process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED = value;
      expect(isEditorRenderSpecV4Enabled()).toBe(false);
    }
    process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED = "true";
    expect(isEditorRenderSpecV4Enabled()).toBe(true);
  });
});
