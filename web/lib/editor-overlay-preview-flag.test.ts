import { describe, expect, it } from "vitest";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";

describe("editor overlay preview feature gate", () => {
  it("requires an explicit development opt in", () => {
    expect(editorOverlayPreviewEnabled({
      NODE_ENV: "development",
      EDITOR_OVERLAY_PREVIEW_ENABLED: " true ",
    })).toBe(true);
    expect(editorOverlayPreviewEnabled({
      NODE_ENV: "development",
      EDITOR_OVERLAY_PREVIEW_ENABLED: "false",
    })).toBe(false);
  });

  it("stays disabled in production even when configured", () => {
    expect(editorOverlayPreviewEnabled({
      NODE_ENV: "production",
      EDITOR_OVERLAY_PREVIEW_ENABLED: "true",
    })).toBe(false);
  });
});
