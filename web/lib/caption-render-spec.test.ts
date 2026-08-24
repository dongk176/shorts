import { describe, expect, it } from "vitest";
import {
  captionRenderSpecForEditor,
  LEGACY_CAPTION_FONT_SNAPSHOT,
  parseCaptionRenderSpec,
} from "./caption-render-spec";

function legacyCaptionSpec() {
  return {
    schemaVersion: 3,
    templateId: "highlight",
    captionPlacement: "lower",
    fps: 30,
    safeArea: { x: 120, y: 1025, width: 840, height: 140 },
    style: {
      fontSize: 72,
      textColor: "#FFFFFF",
      accentColor: "#35E6E3",
      outlineColor: "#080808",
      outlineWidth: 7,
    },
    cues: [{
      startFrame: 0,
      endFrame: 30,
      words: [{ text: "레거시" }],
      events: [{ startFrame: 0, endFrame: 30, activeWordIndex: 0 }],
    }],
  };
}

describe("caption render spec font compatibility", () => {
  it("defaults a missing schema-v3 font to the verified Pretendard snapshot", () => {
    const parsed = parseCaptionRenderSpec(legacyCaptionSpec());

    expect(parsed?.font).toEqual(LEGACY_CAPTION_FONT_SNAPSHOT);
  });

  it("defaults a missing font id without replacing verified font metadata", () => {
    const legacyFont = {
      fileId: "Pretendard-Bold.woff2",
      sha256: LEGACY_CAPTION_FONT_SNAPSHOT.sha256,
      family: "Pretendard",
      weight: 700,
    };
    const parsed = parseCaptionRenderSpec({
      ...legacyCaptionSpec(),
      font: legacyFont,
    });

    expect(parsed?.font).toEqual({
      ...legacyFont,
      fontId: "pretendard",
    });
  });

  it("normalizes a missing font in the captured editor source", () => {
    const parsed = parseCaptionRenderSpec({
      ...legacyCaptionSpec(),
      editorSource: {
        timelineStartSeconds: 10,
        timelineEndSeconds: 20,
        spec: legacyCaptionSpec(),
      },
    });

    expect(parsed).not.toBeNull();
    expect(captionRenderSpecForEditor(parsed!).font)
      .toEqual(LEGACY_CAPTION_FONT_SNAPSHOT);
  });
});
