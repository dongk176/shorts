import { describe, expect, it } from "vitest";
import {
  captionRenderSpecForEditor,
  LEGACY_CAPTION_FONT_SNAPSHOT,
  parseCaptionRenderSpec,
} from "./caption-render-spec";
import {
  EDITOR_FONT_METRICS_REVISION,
  editorCaptionCssToAssBaselineOffsetEmById,
  editorCaptionCssToAssScaleById,
  editorFontSha256ById,
  resolveEditorFontFaceV4,
} from "./editor-fonts";

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

function captionSpecV4(templateId: "pop" | "highlight" = "pop") {
  return {
    schemaVersion: 4,
    templateId,
    layoutMode: "absolute-word-positions-v1",
    wordGapPx: 6,
    joinedWordGapPx: 0,
    captionPlacement: "lower",
    fps: 30,
    safeArea: { x: 120, y: 1025, width: 840, height: 140 },
    font: {
      fontId: "pretendard",
      fileId: "Pretendard-Bold.woff2",
      sha256: editorFontSha256ById.pretendard,
      family: resolveEditorFontFaceV4("pretendard", "title").family,
      weight: 700,
      metrics: {
        revision: EDITOR_FONT_METRICS_REVISION,
        cssToAssScale: editorCaptionCssToAssScaleById.pretendard,
        cssToAssBaselineOffsetEm:
          editorCaptionCssToAssBaselineOffsetEmById.pretendard,
      },
    },
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
      ...(templateId === "highlight"
        ? { separatorAdvanceWidth: 13.914 }
        : {}),
      words: [
        { text: "붙임" },
        { text: "간격", spaceBefore: true },
      ],
      events: [{
        startFrame: 0,
        endFrame: 30,
        ...(templateId === "pop"
          ? {
              activeWordIndex: 0,
              positions: [
                { centerX: 460.125, centerY: 1095, advanceWidth: 120.25, gapBefore: 0 },
                { centerX: 592.375, centerY: 1095, advanceWidth: 138.25, gapBefore: 6 },
              ],
            }
          : {}),
      }],
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

  it("preserves a strict v4 pop contract with one absolute box per word", () => {
    const value = captionSpecV4();
    const parsed = parseCaptionRenderSpec(value);

    expect(parsed).toEqual(value);
    expect(parsed?.schemaVersion).toBe(4);
  });

  it("allows a v4 highlight cue without synthetic word positions", () => {
    const value = captionSpecV4("highlight");
    expect(parseCaptionRenderSpec(value)).toEqual(value);
  });

  it("rejects forged v4 font metadata and non-canonical coordinates", () => {
    const forgedHash = captionSpecV4();
    Object.assign(forgedHash.font, { sha256: "0".repeat(64) });
    expect(parseCaptionRenderSpec(forgedHash)).toBeNull();

    const forgedScale = captionSpecV4();
    Object.assign(forgedScale.font.metrics, { cssToAssScale: 0.84 });
    expect(parseCaptionRenderSpec(forgedScale)).toBeNull();

    const legacyFamily = captionSpecV4();
    Object.assign(legacyFamily.font, { family: "Pretendard" });
    expect(parseCaptionRenderSpec(legacyFamily)).toBeNull();

    const overPrecision = captionSpecV4();
    Object.assign(overPrecision.cues[0].events[0].positions![0], {
      centerX: 460.1251,
    });
    expect(parseCaptionRenderSpec(overPrecision)).toBeNull();
  });

  it("rejects missing pop boxes, invalid active words, and altered gaps", () => {
    const missingBox = captionSpecV4();
    missingBox.cues[0].events[0].positions!.pop();
    expect(parseCaptionRenderSpec(missingBox)).toBeNull();

    const invalidActive = captionSpecV4();
    Object.assign(invalidActive.cues[0].events[0], { activeWordIndex: 2 });
    expect(parseCaptionRenderSpec(invalidActive)).toBeNull();

    const alteredGap = captionSpecV4();
    Object.assign(alteredGap.cues[0].events[0].positions![1], { gapBefore: 0 });
    expect(parseCaptionRenderSpec(alteredGap)).toBeNull();
  });
});
