import { describe, expect, it } from "vitest";
import { editorSubtitlesForSave } from "./editor-subtitle-save";

describe("editorSubtitlesForSave", () => {
  it("removes subtitle cues whose edited text is empty", () => {
    expect(editorSubtitlesForSave([
      { start: 0, end: 1, text: "첫 자막" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: "" },
    ])).toEqual([
      { start: 0, end: 1, text: "첫 자막" },
    ]);
  });

  it("trims saved text without mutating the editor state", () => {
    const source = [{ start: 0, end: 1, text: "  수정한 자막  " }];

    expect(editorSubtitlesForSave(source)).toEqual([
      { start: 0, end: 1, text: "수정한 자막" },
    ]);
    expect(source[0].text).toBe("  수정한 자막  ");
  });
});
