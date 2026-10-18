import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeStoredCaptionComposition } from "./caption-composition-compat";
import { parseCaptionRenderSpec } from "./caption-render-spec";

const fixture = JSON.parse(readFileSync(new URL("../../test-fixtures/caption-composition-5x4.json", import.meta.url), "utf8"));

describe("stored translated caption composition compatibility", () => {
  it("trims empty padding without changing any caption or other layer", () => {
    const original = structuredClone(fixture.stored);
    expect(parseCaptionRenderSpec(original)).not.toBeNull();
    const result = normalizeStoredCaptionComposition(original);
    expect(result).toEqual(fixture.normalized);
    expect(result?.cues).toEqual(original.cues);
    expect(result?.font).toEqual(original.font);
    expect(result?.style).toEqual(original.style);
    expect(original).toEqual(fixture.stored);
    expect(normalizeStoredCaptionComposition(result)).toBeNull();
  });
  it("repairs both clean-clip and extended timeline compositions", () => {
    const value = { ...fixture.stored, editorSource: {
      timelineStartSeconds: 10, timelineEndSeconds: 20, spec: structuredClone(fixture.stored),
    } };
    expect(normalizeStoredCaptionComposition(value)).toEqual({ ...fixture.normalized,
      editorSource: { ...value.editorSource, spec: fixture.normalized },
    });
  });
  it.each(["font", "multiline", "position", "geometry", "untranslated", "mismatched-box", "background"])("leaves %s cases to the existing validation", (change) => {
    const value = structuredClone(fixture.stored);
    if (change === "font") value.style.fontSize = 100;
    if (change === "multiline") value.style.maxLines = 2;
    if (change === "position") value.cues[0].centerY += 100;
    if (change === "geometry") value.layout.video.y -= 16;
    if (change === "untranslated") delete value.translation;
    if (change === "mismatched-box") value.layout.caption.y--;
    if (change === "background") value.style.background = "#000000";
    expect(normalizeStoredCaptionComposition(value)).toBeNull();
  });
  it("does not turn malformed or missing metadata into a valid spec", () => {
    expect(normalizeStoredCaptionComposition(null)).toBeNull();
    expect(normalizeStoredCaptionComposition({ schemaVersion: 4 })).toBeNull();
  });
});

const highlightFixture = JSON.parse(readFileSync(new URL("../../test-fixtures/caption-composition-highlight-5x4.json", import.meta.url), "utf8"));

describe("stored 5:4 highlight composition compatibility", () => {
  it("repairs only composition metadata, preserving absolute caption rendering and provenance", () => {
    const original = structuredClone(highlightFixture.stored);
    expect(parseCaptionRenderSpec(original)).not.toBeNull();
    const result = normalizeStoredCaptionComposition(original);
    expect(result).toEqual(highlightFixture.normalized);
    expect({ ...result, layout: original.layout }).toEqual(original);
    expect(original).toEqual(highlightFixture.stored);
    expect(normalizeStoredCaptionComposition(result)).toBeNull();
  });
  it("repairs clean-clip and extended timeline boxes together", () => {
    const value = { ...highlightFixture.stored, editorSource: {
      timelineStartSeconds: 10, timelineEndSeconds: 20,
      spec: structuredClone(highlightFixture.stored),
    } };
    expect(normalizeStoredCaptionComposition(value)).toEqual({ ...highlightFixture.normalized,
      editorSource: { ...value.editorSource, spec: highlightFixture.normalized },
    });
    expect(value.editorSource.spec).toEqual(highlightFixture.stored);
  });
  it.each(["template", "video", "caption", "safe-area", "version", "cue-position"])("does not widen the repair to unrelated %s data", (change) => {
    const value = structuredClone(highlightFixture.stored);
    if (change === "template") value.templateId = "pop";
    if (change === "video") value.layout.video.y -= 1;
    if (change === "caption") value.layout.caption.y += 1;
    if (change === "safe-area") value.safeArea.y += 1;
    if (change === "version") value.schemaVersion = 3;
    if (change === "cue-position") delete value.cues[0].centerY;
    expect(normalizeStoredCaptionComposition(value)).toBeNull();
  });
});
