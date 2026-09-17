import { describe, expect, it } from "vitest";
import type { CaptionRenderSpec } from "./caption-render-spec";
import { editorScriptForComments } from "./editor-script";

describe("current script for comment regeneration", () => {
  const segments = [{ start: 0, end: 5, text: "original" }];
  const clips = [
    { id: "first", sourceStartSeconds: 1, sourceEndSeconds: 2 },
    { id: "last", sourceStartSeconds: 4, sourceEndSeconds: 5 },
  ];
  it("keeps only the current video cuts when no caption text was edited", () => {
    expect(editorScriptForComments(segments, clips)).toEqual([
      { start: 0, end: 1, text: "original" },
      { start: 1, end: 2, text: "original" },
    ]);
  });
  it.each(["수정한 문구", "Edited text", "修正した字幕"])("uses edited %s text", (text) => {
    const editedCaptions = { fps: 30, cues: [{ startFrame: 0, endFrame: 30,
      words: [{ text }] }] } as CaptionRenderSpec;
    expect(editorScriptForComments(segments, clips, editedCaptions)).toEqual([
      { start: 0, end: 1, text },
      { start: 1, end: 2, text: "original" },
    ]);
    expect(segments[0].text).toBe("original");
  });
});
