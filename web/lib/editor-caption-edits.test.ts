import { describe, expect, it } from "vitest";
import type { CaptionRenderSpec } from "./caption-render-spec";
import {
  editorCaptionCueText,
  editorCaptionTextDraftChanged,
  editorCaptionTextDraftInvalid,
  editorSubtitleLayoutWithCaptionDraft,
  resolveEditorCaptionTextEditTarget,
  retimeCaptionRenderSpecForEditor,
  sanitizeEditorCaptionCueEdits,
  updateEditorCaptionCueEdits,
  updateEditorCaptionCueText,
} from "./editor-caption-preview";

const spec: CaptionRenderSpec = {
  schemaVersion: 3,
  templateId: "highlight",
  captionPlacement: "center",
  fps: 30,
  timingLeadFrames: 7,
  safeArea: { x: 120, y: 666, width: 840, height: 140 },
  font: {
    fontId: "pretendard",
    fileId: "Pretendard-Bold.woff2",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    family: "Pretendard",
    weight: 700,
  },
  style: {
    fontSize: 72,
    textColor: "#FFFFFF",
    accentColor: "#35E6E3",
    outlineColor: "#080808",
    outlineWidth: 7,
  },
  cues: [{
    sourceCueIndex: 7,
    startFrame: 20,
    endFrame: 60,
    fontSize: 72,
    centerX: 540,
    centerY: 736,
    words: [
      { text: "어,", startFrame: 20, endFrame: 30 },
      { text: "잠깐만", startFrame: 30, endFrame: 40, spaceBefore: true },
      { text: "포션", startFrame: 40, endFrame: 50, spaceBefore: true },
      { text: "없니?", startFrame: 50, endFrame: 60, spaceBefore: true },
    ],
    lines: [[0, 1, 2, 3]],
    events: [
      { startFrame: 20, endFrame: 30, activeWordIndex: 0 },
      { startFrame: 30, endFrame: 40, activeWordIndex: 1 },
      { startFrame: 40, endFrame: 50, activeWordIndex: 2 },
      { startFrame: 50, endFrame: 60, activeWordIndex: 3 },
    ],
  }],
};

describe("editor caption text edits", () => {
  it("resolves and updates a sparse source cue id instead of an array offset", () => {
    const target = resolveEditorCaptionTextEditTarget(spec, 7);
    expect(target).toEqual({
      sourceCueIndex: 7,
      originalText: "어, 잠깐만 포션 없니?",
      currentText: "어, 잠깐만 포션 없니?",
    });
    expect(resolveEditorCaptionTextEditTarget(spec, 0)).toBeNull();
    expect(updateEditorCaptionCueText(spec, [], 7, "수정한 전체 문장"))
      .toEqual([{ cueIndex: 7, text: "수정한 전체 문장" }]);
  });

  it("removes only the matching source edit when restoring its original text", () => {
    expect(updateEditorCaptionCueText(spec, [
      { cueIndex: 6, text: "다른 자막 수정" },
      { cueIndex: 7, text: "잠깐만 포션이 정말 없어요?" },
    ], 7, "어, 잠깐만 포션 없니?"))
      .toEqual([{ cueIndex: 6, text: "다른 자막 수정" }]);
  });

  it("treats an empty draft as an invalid no-op for history and saving", () => {
    expect(editorCaptionTextDraftChanged("원래 자막", "")).toBe(false);
    expect(editorCaptionTextDraftChanged("원래 자막", "   ")).toBe(false);
    expect(editorCaptionTextDraftChanged("원래 자막", "수정 자막")).toBe(true);
    expect(editorCaptionTextDraftInvalid("원래 자막", "")).toBe(true);
    expect(editorCaptionTextDraftInvalid("원래 자막", "   ")).toBe(true);
    expect(editorCaptionTextDraftInvalid("원래 자막", "원래 자막")).toBe(false);
    expect(updateEditorCaptionCueEdits(
      [{ cueIndex: 7, text: "기존 수정" }],
      7,
      "원래 자막",
      "",
    )).toEqual([{ cueIndex: 7, text: "기존 수정" }]);
  });

  it("places an active valid draft into the autosave subtitle layout", () => {
    const layout = { offsetY: 632, scale: 1, cueEdits: [] };
    expect(editorSubtitleLayoutWithCaptionDraft(layout, {
      sourceCueIndex: 7,
      initialText: "어, 잠깐만 포션 없니?",
      originalText: "어, 잠깐만 포션 없니?",
      text: "자동 저장할 수정 자막",
    })).toEqual({
      offsetY: 632,
      scale: 1,
      cueEdits: [{ cueIndex: 7, text: "자동 저장할 수정 자막" }],
    });
    expect(editorSubtitleLayoutWithCaptionDraft(layout, {
      sourceCueIndex: 7,
      initialText: "어, 잠깐만 포션 없니?",
      originalText: "어, 잠깐만 포션 없니?",
      text: "",
    })).toEqual(layout);
  });

  it("opens the immutable full source text when a trim shows only a fragment", () => {
    const retimed = retimeCaptionRenderSpecForEditor(spec, [{
      id: "trimmed",
      sourceStartSeconds: 1,
      sourceEndSeconds: 2,
    }]);
    expect(retimed?.cues[0]?.sourceCueIndex).toBe(7);
    expect(retimed?.cues[0] && editorCaptionCueText(retimed.cues[0]))
      .toBe("잠깐만 포션 없니?");
    expect(resolveEditorCaptionTextEditTarget(spec, 7)?.currentText)
      .toBe("어, 잠깐만 포션 없니?");
  });

  it("keeps one stable edit id when cuts retain two pieces of the same source cue", () => {
    const retimed = retimeCaptionRenderSpecForEditor(spec, [
      { id: "first", sourceStartSeconds: 20 / 30, sourceEndSeconds: 35 / 30 },
      { id: "second", sourceStartSeconds: 45 / 30, sourceEndSeconds: 2 },
    ]);
    expect(retimed?.cues.length).toBe(2);
    expect(retimed?.cues.map((cue) => cue.sourceCueIndex)).toEqual([7, 7]);
    expect(updateEditorCaptionCueText(
      spec,
      [{ cueIndex: 7, text: "첫 수정" }],
      7,
      "두 번째 수정",
    )).toEqual([{ cueIndex: 7, text: "두 번째 수정" }]);

    const editedRetime = retimeCaptionRenderSpecForEditor(
      spec,
      [
        { id: "first", sourceStartSeconds: 20 / 30, sourceEndSeconds: 35 / 30 },
        { id: "second", sourceStartSeconds: 45 / 30, sourceEndSeconds: 2 },
      ],
      [{ cueIndex: 7, text: "하나 둘 셋 넷" }],
    );
    expect(editedRetime?.cues.map((cue) => cue.sourceCueIndex))
      .toEqual([7, 7]);
    expect(editedRetime?.cues.flatMap((cue) => (
      cue.words.map((word) => word.text)
    ))).not.toContain("포션");
  });

  it("falls back to the array index for legacy specs without source ids", () => {
    const legacy = {
      ...spec,
      cues: spec.cues.map((cue) => ({
        ...cue,
        sourceCueIndex: undefined,
      })),
    };
    expect(resolveEditorCaptionTextEditTarget(legacy, 0)?.originalText)
      .toBe("어, 잠깐만 포션 없니?");
    expect(updateEditorCaptionCueText(legacy, [], 0, "레거시 수정"))
      .toEqual([{ cueIndex: 0, text: "레거시 수정" }]);
  });

  it("fails closed for duplicate raw source ids and removes invalid old edits", () => {
    const duplicate = {
      ...spec,
      cues: [spec.cues[0], {
        ...spec.cues[0],
        startFrame: 70,
        endFrame: 100,
      }],
    };
    expect(resolveEditorCaptionTextEditTarget(duplicate, 7)).toBeNull();
    expect(sanitizeEditorCaptionCueEdits(duplicate, [
      { cueIndex: 7, text: "중복 ID 수정" },
      { cueIndex: 99, text: "없는 ID 수정" },
    ])).toEqual([]);
  });
});
