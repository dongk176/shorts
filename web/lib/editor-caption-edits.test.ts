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

const project3781Spec: CaptionRenderSpec = {
  ...spec,
  cues: [{
    sourceCueIndex: 2,
    startFrame: 39,
    endFrame: 66,
    fontSize: 72,
    centerX: 540,
    centerY: 736,
    words: [
      {
        text: "무너지고",
        startFrame: 39,
        endFrame: 56,
        speechStartFrame: 46,
        speechEndFrame: 56,
      },
      {
        text: "있습니다",
        startFrame: 52,
        endFrame: 67,
        speechStartFrame: 59,
        speechEndFrame: 67,
        spaceBefore: true,
      },
    ],
    lines: [[0, 1]],
    events: [
      { startFrame: 39, endFrame: 56, activeWordIndex: 0 },
      { startFrame: 56, endFrame: 66, activeWordIndex: 1 },
    ],
  }],
};

function captionWordFrames(retimed: CaptionRenderSpec | null) {
  return retimed?.cues.flatMap((cue) => cue.words.map((word) => ({
    text: word.text,
    startFrame: word.startFrame,
    endFrame: word.endFrame,
  })));
}

function expectNoCaptionOverlap(
  retimed: CaptionRenderSpec | null,
  totalOutputFrames: number,
) {
  expect(retimed).not.toBeNull();
  expect(retimed?.cues.every((cue, cueIndex, cues) => (
    cue.startFrame >= 0
    && cue.endFrame > cue.startFrame
    && cue.endFrame <= totalOutputFrames
    && (cueIndex === 0 || cues[cueIndex - 1].endFrame <= cue.startFrame)
  ))).toBe(true);
  expect(retimed?.cues.every((cue) => (
    cue.words.every((word) => (
      word.startFrame != null
      && word.endFrame != null
      && word.startFrame >= cue.startFrame
      && word.endFrame > word.startFrame
      && word.endFrame <= cue.endFrame
    ))
    && cue.events.every((event, eventIndex, events) => (
      event.startFrame >= cue.startFrame
      && event.endFrame > event.startFrame
      && event.endFrame <= cue.endFrame
      && event.endFrame <= totalOutputFrames
      && (eventIndex === 0 || events[eventIndex - 1].endFrame <= event.startFrame)
    ))
  ))).toBe(true);
}

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
  });

  it("keeps the complete #3781 cue edit after a leading trim and adjacent split", () => {
    const retimed = retimeCaptionRenderSpecForEditor(
      project3781Spec,
      [
        {
          id: "before-adjacent-split",
          sourceStartSeconds: 58 / 30,
          sourceEndSeconds: 101 / 30,
        },
        {
          id: "after-adjacent-split",
          sourceStartSeconds: 101 / 30,
          sourceEndSeconds: 1258 / 30,
        },
      ],
      [{ cueIndex: 2, text: "무너지고 있습니다 파일럿" }],
    );
    const unsplit = retimeCaptionRenderSpecForEditor(
      project3781Spec,
      [{
        id: "without-adjacent-split",
        sourceStartSeconds: 58 / 30,
        sourceEndSeconds: 1258 / 30,
      }],
      [{ cueIndex: 2, text: "무너지고 있습니다 파일럿" }],
    );

    expect(retimed?.cues.flatMap((cue) => cue.words.map((word) => word.text)))
      .toEqual(["무너지고", "있습니다", "파일럿"]);
    expect(captionWordFrames(retimed)).toEqual([
      { text: "무너지고", startFrame: 0, endFrame: 3 },
      { text: "있습니다", startFrame: 3, endFrame: 6 },
      { text: "파일럿", startFrame: 6, endFrame: 8 },
    ]);
    expect(retimed).toEqual(unsplit);
    expect(retimed?.cues.every((cue) => cue.sourceCueIndex === 2)).toBe(true);
    expectNoCaptionOverlap(retimed, 1200);
  });

  it("keeps the complete cue edit after a trailing trim", () => {
    const retimed = retimeCaptionRenderSpecForEditor(
      spec,
      [{ id: "trim-tail", sourceStartSeconds: 0, sourceEndSeconds: 50 / 30 }],
      [{ cueIndex: 7, text: "하나 둘 셋 넷" }],
    );

    expect(retimed?.cues.flatMap((cue) => cue.words.map((word) => word.text)))
      .toEqual(["하나", "둘", "셋", "넷"]);
    expect(captionWordFrames(retimed)).toEqual([
      { text: "하나", startFrame: 20, endFrame: 32 },
      { text: "둘", startFrame: 32, endFrame: 38 },
      { text: "셋", startFrame: 38, endFrame: 44 },
      { text: "넷", startFrame: 44, endFrame: 50 },
    ]);
    expectNoCaptionOverlap(retimed, 50);
  });

  it("rebuilds a cue edit once across a disjoint deleted gap", () => {
    const retimed = retimeCaptionRenderSpecForEditor(
      spec,
      [
        {
          id: "keep-before-gap",
          sourceStartSeconds: 20 / 30,
          sourceEndSeconds: 35 / 30,
        },
        {
          id: "keep-after-gap",
          sourceStartSeconds: 45 / 30,
          sourceEndSeconds: 2,
        },
      ],
      [{ cueIndex: 7, text: "하나 둘 셋 넷" }],
    );

    expect(retimed?.cues.flatMap((cue) => cue.words.map((word) => word.text)))
      .toEqual(["하나", "둘", "셋", "넷"]);
    expect(captionWordFrames(retimed)).toEqual([
      { text: "하나", startFrame: 0, endFrame: 12 },
      { text: "둘", startFrame: 12, endFrame: 18 },
      { text: "셋", startFrame: 18, endFrame: 24 },
      { text: "넷", startFrame: 24, endFrame: 30 },
    ]);
    expect(retimed?.cues.every((cue) => cue.sourceCueIndex === 7)).toBe(true);
    expectNoCaptionOverlap(retimed, 30);
  });

  it("drops an edited cue when video clips remove it completely", () => {
    expect(retimeCaptionRenderSpecForEditor(
      spec,
      [{ id: "after-cue", sourceStartSeconds: 2, sourceEndSeconds: 3 }],
      [{ cueIndex: 7, text: "남으면 안 되는 수정" }],
    )).toBeNull();
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
