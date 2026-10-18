import { describe, expect, it } from "vitest";
import { captionSearchRows, findCaptionMatches, planCaptionReplacement, type CaptionSearchRow } from "./editor-caption-find-replace";
import { createEditorHighlightCaptionSpec, retimeCaptionRenderSpecForEditor, editorCaptionCueText } from "./editor-caption-preview";
import { normalizeEditorSubtitleLayout } from "./editor-render-spec";
const row = (id: number, text: string): CaptionSearchRow => ({ id, text, originalText: text, seconds: id });
const rows = [row(2, "이즈컷을 이즈컷으로"), row(5, "이즈컷입니다"), row(8, "그대로")];
const request = { query: "이즈컷", replacement: "이지컷", matchCase: false };

describe("caption find and replace", () => {
  it("finds literal occurrences with optional case sensitivity", () => {
    expect(findCaptionMatches(rows, "이즈컷")).toHaveLength(3);
    expect(findCaptionMatches([row(0, "[a].* [a].*")], "[a].*")).toHaveLength(2);
    expect(findCaptionMatches([row(0, "EasyCUT easycut")], "easycut")).toHaveLength(2);
    expect(findCaptionMatches([row(0, "EasyCUT easycut")], "easycut", true)).toHaveLength(1);
    expect(findCaptionMatches(rows, "  ")).toEqual([]);
    expect(findCaptionMatches([row(0, "東京の字幕🙂 東京")], "東京")).toHaveLength(2);
  });
  it("replaces only the selected occurrence, preserving unrelated edits", () => {
    const edits = [{ cueIndex: 99, text: "기존 수정" }];
    const target = findCaptionMatches(rows, "이즈컷")[1];
    const result = planCaptionReplacement(rows, edits, { ...request, target });
    expect(result.count).toBe(1);
    expect(result.edits).toEqual([{ cueIndex: 2, text: "이즈컷을 이지컷으로" }, ...edits]);
    expect(edits).toEqual([{ cueIndex: 99, text: "기존 수정" }]);
  });
  it("replaces all without interpreting replacement tokens", () => {
    const result = planCaptionReplacement(rows, [], { ...request, replacement: "$&" });
    expect(result.count).toBe(3);
    expect(result.edits).toEqual([{ cueIndex: 2, text: "$&을 $&으로" }, { cueIndex: 5, text: "$&입니다" }]);
  });
  it("allows partial deletion but rejects empty/oversized captions atomically", () => {
    expect(planCaptionReplacement(rows, [], { ...request, replacement: "" }).count).toBe(3);
    const edits = [{ cueIndex: 99, text: "보존" }];
    expect(planCaptionReplacement([...rows, row(9, "이즈컷")], edits, { ...request, replacement: "" })).toEqual({ edits, count: 0, error: "empty" });
    expect(planCaptionReplacement(rows, edits, { ...request, replacement: "가".repeat(200) })).toEqual({ edits, count: 0, error: "too-long" });
  });
  it("removes restored overrides and ignores no-ops/stale selections", () => {
    expect(planCaptionReplacement([{ ...rows[0], text: "이지컷을 이지컷으로" }], [{ cueIndex: 2, text: "이지컷을 이지컷으로" }], { ...request, query: "이지컷", replacement: "이즈컷" }).edits).toEqual([]);
    expect(planCaptionReplacement(rows, [], { ...request, replacement: request.query }).count).toBe(0);
    expect(planCaptionReplacement(rows, [], { ...request, target: { cueIndex: 2, start: 1, end: 4 } }).count).toBe(0);
  });
  it("uses the current cut and preserves timing through the existing caption compiler", () => {
    const measure = (text: string, size: number) => text.length * size * 0.5;
    const spec = createEditorHighlightCaptionSpec([{ start: 0, end: 2, text: "이즈컷" }, { start: 3, end: 5, text: "제외" }], "16:9", undefined, undefined, measure)!;
    if (spec.schemaVersion !== 3) throw new Error("Expected v3 fixture");
    const clips = [{ id: "clip", sourceStartSeconds: 0, sourceEndSeconds: 2 }];
    const preview = retimeCaptionRenderSpecForEditor(spec, clips, [], measure)!;
    const visible = captionSearchRows(spec, preview, []);
    expect(visible.map(r => r.text)).toEqual(["이즈컷"]);
    const plan = planCaptionReplacement(visible, [], request);
    const layout = normalizeEditorSubtitleLayout({ offsetY: 0, scale: 1, cueEdits: plan.edits });
    const output = retimeCaptionRenderSpecForEditor(spec, clips, layout.cueEdits, measure)!;
    expect(output.cues.map(editorCaptionCueText).join("")).toBe("이지컷");
    expect(output.cues[0].startFrame).toBe(preview.cues[0].startFrame);
    expect(output.cues.at(-1)!.endFrame).toBe(preview.cues.at(-1)!.endFrame);
    expect(captionSearchRows(spec, null, [])).toEqual([]);
    expect(captionSearchRows({ ...spec, cues: [spec.cues[0], { ...spec.cues[0], sourceCueIndex: 0 }] }, preview, [])).toEqual([]);
  });
});
