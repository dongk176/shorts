import { describe, expect, it } from "vitest";
import type { EditorDocumentSnapshot } from "./editor-document-snapshot";
import { projectScriptText } from "./project-script";

const document = (segments: { start: number; end: number; text: string }[], ranges: number[][]) => ({
  subtitles: { segments },
  video: { clips: ranges.map(([start, end], i) => ({ id: String(i), sourceStartSeconds: start, sourceEndSeconds: end })) },
}) as EditorDocumentSnapshot;

describe("project transcript after silence cuts", () => {
  it.each(["그만 밟아.", "Stop pressing.", "踏まないで。"])("shows a split source sentence once: %s", text => {
    expect(projectScriptText([], document([{ start: 30, end: 35, text }], [[30, 31], [32, 33], [34, 35]]))).toBe(text);
  });
  it("keeps genuinely repeated dialogue and removes fully excluded sentences", () => {
    expect(projectScriptText([], document([
      { start: 0, end: 2, text: "네" },
      { start: 2, end: 3, text: "제외" },
      { start: 3, end: 4, text: "네" },
    ], [[0, 1], [1.5, 2], [3, 4]]))).toBe("네 네");
  });
  it("keeps an intentionally replayed source sentence", () => {
    expect(projectScriptText([], document([{ start: 0, end: 2, text: "다시" }], [[0, 2], [0, 2]]))).toBe("다시 다시");
  });
  it("uses stored rendered text for legacy projects without a document", () => {
    expect(projectScriptText([{ start: 0, end: 1, text: "원문" }])).toBe("원문");
  });
});
