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
