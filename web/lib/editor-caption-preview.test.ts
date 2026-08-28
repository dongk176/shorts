import { describe, expect, it } from "vitest";
import {
  captionRenderSpecForEditor,
  parseCaptionRenderSpec,
  type CaptionRenderSpec,
  type CaptionRenderSpecV4,
} from "./caption-render-spec";
import {
  EDITOR_FONT_METRICS_REVISION,
  editorCaptionCssToAssBaselineOffsetEmById,
  editorCaptionCssToAssScaleById,
  editorFontSha256ById,
  editorWordSpaceAdvanceEmById,
  resolveEditorFontFaceV4,
} from "./editor-fonts";
import {
  createEditorHighlightCaptionSpec,
  editorCaptionVerticalOffsetBounds,
  retimeCaptionRenderSpecForEditor,
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
    startFrame: 23,
    endFrame: 40,
    fontSize: 72,
    centerX: 540,
    centerY: 736,
    words: [{ text: "선행", startFrame: 23, endFrame: 40 }],
    lines: [[0]],
    events: [{ startFrame: 23, endFrame: 40, activeWordIndex: 0 }],
  }],
};

function v4CaptionFixture(
  templateId: "pop" | "highlight",
): CaptionRenderSpecV4 {
  const pop = templateId === "pop";
  const parsed = parseCaptionRenderSpec({
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
      fontSize: pop ? 92 : 72,
      textColor: "#FFFFFF",
      accentColor: "#35E6E3",
      outlineColor: "#080808",
      outlineWidth: pop ? 8 : 7,
    },
    cues: [{
      startFrame: 0,
      endFrame: 90,
      ...(pop ? {} : {
        fontSize: 72,
        scaleX: 100,
        centerX: 540,
        centerY: 1095,
        lines: [[0, 1, 2]],
        wordSeparator: " ",
        separatorAdvanceWidth: Math.round(
          editorWordSpaceAdvanceEmById.pretendard
          * 72
          * editorCaptionCssToAssScaleById.pretendard
          * 1_000,
        ) / 1_000,
      }),
      words: [
        { text: "한글", startFrame: 0, endFrame: 30 },
        { text: "English", startFrame: 30, endFrame: 60, spaceBefore: true },
        { text: "123", startFrame: 60, endFrame: 90, spaceBefore: true },
      ],
      events: pop
        ? [0, 1, 2].map((activeWordIndex) => ({
            startFrame: activeWordIndex * 30,
            endFrame: activeWordIndex * 30 + 30,
            activeWordIndex,
            positions: [
              { centerX: 390, centerY: 1095, advanceWidth: 120, gapBefore: 0 },
              { centerX: 520, centerY: 1095, advanceWidth: 128, gapBefore: 6 },
              { centerX: 650, centerY: 1095, advanceWidth: 120, gapBefore: 6 },
            ],
          }))
        : [0, 1, 2].map((activeWordIndex) => ({
            startFrame: activeWordIndex * 30,
            endFrame: activeWordIndex * 30 + 30,
            activeWordIndex,
          })),
    }],
  });
  if (!parsed || parsed.schemaVersion !== 4) {
    throw new Error("invalid v4 caption fixture");
  }
  return parsed;
}

describe("editor caption preview timing", () => {
  it("compiles ordinary transcript segments into deterministic highlight cues", () => {
    const highlighted = createEditorHighlightCaptionSpec(
      [
        { start: 1, end: 2.5, text: "일반 자막 강조" },
        { start: 2.5, end: 3.5, text: "다음 자막" },
      ],
      "16:9",
      "#16A34A",
      "pretendard",
      (text, fontSize) => Array.from(text).length * fontSize * 0.7,
    );

    expect(highlighted).toMatchObject({
      templateId: "highlight",
      timingLeadFrames: 7,
      style: { accentColor: "#16A34A" },
      font: { fontId: "pretendard" },
    });
    expect(highlighted?.cues.flatMap((cue) => (
      cue.events.map((event) => event.activeWordIndex)
    ))).toEqual([0, 1, 2, 3, 4]);
    expect(highlighted?.cues[0]?.words[0]).toMatchObject({
      text: "일반",
      startFrame: 23,
      speechStartFrame: 30,
    });
    expect(highlighted?.cues.every((cue, index, cues) => (
      index === cues.length - 1 || cue.endFrame <= cues[index + 1].startFrame
    ))).toBe(true);
    const edited = highlighted && retimeCaptionRenderSpecForEditor(
      highlighted,
      [{ id: "whole", sourceStartSeconds: 0, sourceEndSeconds: 4 }],
      [{ cueIndex: 0, text: "수정한 강조 자막" }],
      (text, fontSize) => Array.from(text).length * fontSize * 0.7,
    );
    expect(edited?.cues[0]?.words.map((word) => word.text))
      .toEqual(["수정한", "강조", "자막"]);
  });

  it("keeps the compiled seven-frame lead after source clips are retimed", () => {
    const retimed = retimeCaptionRenderSpecForEditor(spec, [{
      id: "clip-a",
      sourceStartSeconds: 0.5,
      sourceEndSeconds: 1.5,
    }]);

    expect(retimed?.timingLeadFrames).toBe(7);
    expect(retimed?.cues[0]?.sourceCueIndex).toBe(0);
    expect(retimed?.cues[0]?.events[0]).toMatchObject({
      startFrame: 8,
      endFrame: 25,
    });
    // The spoken word starts at source frame 30. In this clip that is output
    // frame 15, so the preview remains exactly seven frames early.
    expect(15 - (retimed?.cues[0]?.events[0]?.startFrame || 0)).toBe(7);
  });

  it("drops caption events removed by the edited video clips", () => {
    expect(retimeCaptionRenderSpecForEditor(spec, [{
      id: "clip-b",
      sourceStartSeconds: 2,
      sourceEndSeconds: 3,
    }])).toBeNull();
  });

  it("removes deleted words and preserves the remaining word indexes", () => {
    const multiWord: CaptionRenderSpec = {
      ...spec,
      cues: [{
        ...spec.cues[0],
        startFrame: 20,
        endFrame: 100,
        words: [
          { text: "남김", startFrame: 20, endFrame: 35 },
          { text: "삭제", startFrame: 45, endFrame: 60, spaceBefore: true },
          { text: "다시", startFrame: 75, endFrame: 90, spaceBefore: true },
        ],
        lines: [[0, 1, 2]],
        events: [
          { startFrame: 20, endFrame: 40, activeWordIndex: 0 },
          { startFrame: 40, endFrame: 70, activeWordIndex: 1 },
          { startFrame: 70, endFrame: 100, activeWordIndex: 2 },
        ],
      }],
    };

    const retimed = retimeCaptionRenderSpecForEditor(multiWord, [
      { id: "keep-a", sourceStartSeconds: 0, sourceEndSeconds: 1.3 },
      { id: "keep-b", sourceStartSeconds: 2.3, sourceEndSeconds: 3.5 },
    ]);

    expect(retimed?.cues.flatMap((cue) => cue.words.map((word) => word.text)))
      .toEqual(["남김", "다시"]);
    expect(retimed?.cues.flatMap((cue) => (
      cue.events.map((event) => event.activeWordIndex)
    ))).toEqual([0, 0]);
  });

  it.each(["pop", "highlight"] as const)(
    "preserves a subframe spoken word while reflowing %s captions",
    (templateId) => {
      const subframeWord: CaptionRenderSpec = {
        ...spec,
        templateId,
        cues: [{
          startFrame: 20,
          endFrame: 40,
          words: [
            {
              text: "말도",
              startFrame: 20,
              endFrame: 30,
              speechStartFrame: 24,
              speechEndFrame: 30,
            },
            {
              text: "안",
              startFrame: 28,
              endFrame: 32,
              speechStartFrame: 32,
              speechEndFrame: 32,
              spaceBefore: true,
            },
            {
              text: "돼",
              startFrame: 31,
              endFrame: 38,
              speechStartFrame: 34,
              speechEndFrame: 38,
              spaceBefore: true,
            },
          ],
          lines: [[0, 1, 2]],
          events: [
            { startFrame: 20, endFrame: 28, activeWordIndex: 0 },
            { startFrame: 28, endFrame: 32, activeWordIndex: 1 },
            { startFrame: 32, endFrame: 40, activeWordIndex: 2 },
          ],
        }],
      };

      const retimed = retimeCaptionRenderSpecForEditor(subframeWord, [{
        id: "boundary-cut",
        sourceStartSeconds: 0,
        sourceEndSeconds: 36 / 30,
      }]);

      expect(retimed?.cues.flatMap((cue) => (
        cue.words.map((word) => word.text)
      ))).toEqual(["말도", "안", "돼"]);
      expect(retimed?.cues.flatMap((cue) => cue.words).find((word) => (
        word.text === "안"
      ))).toMatchObject({
        speechStartFrame: 32,
        speechEndFrame: 33,
      });
    },
  );

  it("preserves immutable pop positions when an editor clip retains every word", () => {
    const positions = [
      { centerX: 405.185, centerY: 736 },
      { centerX: 579.758, centerY: 736 },
      { centerX: 714.573, centerY: 736 },
    ];
    const pop: CaptionRenderSpec = {
      ...spec,
      templateId: "pop",
      cues: [{
        startFrame: 20,
        endFrame: 70,
        words: [
          { text: "대비", startFrame: 20, endFrame: 35, fontSize: 92 },
          { text: "십삼", startFrame: 35, endFrame: 50, fontSize: 92, spaceBefore: true },
          { text: "점", startFrame: 50, endFrame: 70, fontSize: 92, spaceBefore: true },
        ],
        events: [{
          startFrame: 20,
          endFrame: 35,
          activeWordIndex: 0,
          positions,
        }],
      }],
    };

    const retimed = retimeCaptionRenderSpecForEditor(pop, [{
      id: "whole-cue",
      sourceStartSeconds: 0,
      sourceEndSeconds: 3,
    }]);

    expect(retimed?.cues[0]?.events[0]?.positions).toEqual(positions);
  });

  it("preserves stored v4 geometry while shifting a single padded source clip", () => {
    const source = v4CaptionFixture("pop");
    const padded: CaptionRenderSpecV4 = {
      ...source,
      cues: source.cues.map((cue) => ({
        ...cue,
        startFrame: cue.startFrame + 60,
        endFrame: cue.endFrame + 60,
        words: cue.words.map((word) => ({
          ...word,
          startFrame: word.startFrame == null ? undefined : word.startFrame + 60,
          endFrame: word.endFrame == null ? undefined : word.endFrame + 60,
        })),
        events: cue.events.map((event) => ({
          ...event,
          startFrame: event.startFrame + 60,
          endFrame: event.endFrame + 60,
        })),
      })),
    };
    const originalPositions = structuredClone(
      padded.cues[0]?.events[0]?.positions,
    );
    const retimed = retimeCaptionRenderSpecForEditor(
      padded,
      [{ id: "padded", sourceStartSeconds: 2, sourceEndSeconds: 5 }],
      [],
      undefined,
      {
        layout: {
          offsetY: 0,
          scale: 1,
          fontId: padded.font.fontId,
          fontSize: padded.style.fontSize,
          color: padded.style.textColor,
          accentColor: padded.style.accentColor,
        },
      },
    );

    expect(retimed?.cues[0]?.startFrame).toBe(0);
    expect(retimed?.cues[0]?.endFrame).toBe(90);
    expect(retimed?.cues[0]?.events[0]?.positions).toEqual(originalPositions);
    expect(retimed?.safeArea).toEqual(padded.safeArea);
  });

  it("ignores padded outside cues without reflowing the selected v4 cue", () => {
    const source = v4CaptionFixture("pop");
    const shiftCue = (frameOffset: number, centerOffset: number) => ({
      ...structuredClone(source.cues[0]),
      startFrame: source.cues[0].startFrame + frameOffset,
      endFrame: source.cues[0].endFrame + frameOffset,
      words: source.cues[0].words.map((word) => ({
        ...word,
        startFrame: word.startFrame == null
          ? undefined
          : word.startFrame + frameOffset,
        endFrame: word.endFrame == null
          ? undefined
          : word.endFrame + frameOffset,
      })),
      events: source.cues[0].events.map((event) => ({
        ...event,
        startFrame: event.startFrame + frameOffset,
        endFrame: event.endFrame + frameOffset,
        positions: event.positions?.map((position) => ({
          ...position,
          centerX: position.centerX + centerOffset,
        })),
      })),
    });
    const padded: CaptionRenderSpecV4 = {
      ...source,
      cues: [
        shiftCue(0, -70),
        shiftCue(120, -39),
        shiftCue(240, 85),
      ],
    };
    const selectedPositions = structuredClone(
      padded.cues[1].events[0].positions,
    );

    const retimed = retimeCaptionRenderSpecForEditor(
      padded,
      [{ id: "selected", sourceStartSeconds: 4, sourceEndSeconds: 7 }],
      [],
      undefined,
      {
        layout: {
          offsetY: 0,
          scale: 1,
          fontId: padded.font.fontId,
          fontSize: padded.style.fontSize,
          color: padded.style.textColor,
          accentColor: padded.style.accentColor,
        },
      },
    );

    expect(retimed?.cues).toHaveLength(1);
    expect(retimed?.cues[0]).toMatchObject({ startFrame: 0, endFrame: 90 });
    expect(retimed?.cues[0].events[0].positions).toEqual(selectedPositions);
    expect(retimed?.cues[0].events[0].positions?.[0].centerX).toBe(351);
  });

  it("reflows an edited final pop word into the same standalone cue as rendering", () => {
    const pop: CaptionRenderSpec = {
      ...spec,
      templateId: "pop",
      safeArea: { x: 120, y: 666, width: 840, height: 140 },
      cues: [{
        startFrame: 0,
        endFrame: 60,
        words: [
          { text: "하나", startFrame: 0, endFrame: 20, speechStartFrame: 0, speechEndFrame: 20 },
          { text: "둘", startFrame: 20, endFrame: 40, speechStartFrame: 20, speechEndFrame: 40, spaceBefore: true },
          { text: "셋", startFrame: 40, endFrame: 60, speechStartFrame: 40, speechEndFrame: 60, spaceBefore: true },
        ],
        events: [
          { startFrame: 0, endFrame: 20, activeWordIndex: 0 },
          { startFrame: 20, endFrame: 40, activeWordIndex: 1 },
          { startFrame: 40, endFrame: 60, activeWordIndex: 2 },
        ],
      }],
    };
    const measure = (text: string, fontSize: number) => (
      Array.from(text).length * fontSize
    );

    const retimed = retimeCaptionRenderSpecForEditor(
      pop,
      [{ id: "whole", sourceStartSeconds: 0, sourceEndSeconds: 2 }],
      [{ cueIndex: 0, text: "하나 둘 마지막수정단어" }],
      measure,
    );

    expect(retimed?.cues.map((cue) => cue.words.map((word) => word.text)))
      .toEqual([["하나", "둘"], ["마지막수정단어"]]);
    expect(retimed?.cues.map((cue) => ({
      startFrame: cue.startFrame,
      endFrame: cue.endFrame,
      fontSizes: cue.words.map((word) => word.fontSize),
      events: cue.events.map((event) => [
        event.startFrame,
        event.endFrame,
        event.activeWordIndex,
      ]),
    }))).toEqual([
      {
        startFrame: 0,
        endFrame: 18,
        fontSizes: [92, 92],
        events: [[0, 12, 0], [12, 18, 1]],
      },
      {
        startFrame: 18,
        endFrame: 60,
        fontSizes: [92],
        events: [[18, 60, 0]],
      },
    ]);
    expect(retimed?.cues[1]?.events.every((event) => event.activeWordIndex === 0))
      .toBe(true);
    expect(retimed?.cues[0]?.endFrame).toBeLessThanOrEqual(
      retimed?.cues[1]?.startFrame || 0,
    );
  });

  it("assigns an equal-overlap crossing word to the earliest output clip only", () => {
    const crossing: CaptionRenderSpec = {
      ...spec,
      cues: [{
        startFrame: 20,
        endFrame: 70,
        words: [{
          text: "경계단어",
          startFrame: 20,
          endFrame: 70,
          speechStartFrame: 20,
          speechEndFrame: 70,
        }],
        lines: [[0]],
        events: [{ startFrame: 20, endFrame: 70, activeWordIndex: 0 }],
      }],
    };

    const retimed = retimeCaptionRenderSpecForEditor(crossing, [
      {
        id: "left",
        sourceStartSeconds: 20 / 30,
        sourceEndSeconds: 35 / 30,
      },
      {
        id: "right",
        sourceStartSeconds: 55 / 30,
        sourceEndSeconds: 70 / 30,
      },
    ]);

    expect(retimed?.cues.flatMap((cue) => cue.words).map((word) => word.text))
      .toEqual(["경계단어"]);
    expect(retimed?.cues[0]?.words[0]).toMatchObject({
      startFrame: 0,
      endFrame: 15,
      speechStartFrame: 0,
      speechEndFrame: 15,
    });
    expect(retimed?.cues[0]?.events).toEqual([{
      startFrame: 0,
      endFrame: 15,
      activeWordIndex: 0,
    }]);
  });

  it("serializes overlapping immutable cue handoffs in the preview", () => {
    const overlapping: CaptionRenderSpec = {
      ...spec,
      cues: [
        {
          ...spec.cues[0],
          startFrame: 10,
          endFrame: 40,
          words: [{ text: "앞", startFrame: 10, endFrame: 40 }],
          events: [{ startFrame: 10, endFrame: 40, activeWordIndex: 0 }],
        },
        {
          ...spec.cues[0],
          startFrame: 33,
          endFrame: 60,
          words: [{ text: "뒤", startFrame: 33, endFrame: 60 }],
          events: [{ startFrame: 33, endFrame: 60, activeWordIndex: 0 }],
        },
      ],
    };

    const retimed = retimeCaptionRenderSpecForEditor(overlapping, [{
      id: "whole",
      sourceStartSeconds: 0,
      sourceEndSeconds: 2,
    }]);

    expect(retimed?.cues[0]?.endFrame).toBe(33);
    expect(retimed?.cues[1]?.startFrame).toBe(33);
  });

  it("uses the padded word source saved with a captured edit timeline", () => {
    const parsed = parseCaptionRenderSpec({
      ...spec,
      editorSource: {
        timelineStartSeconds: 10,
        timelineEndSeconds: 80,
        spec: {
          ...spec,
          cues: [{
            ...spec.cues[0],
            words: [{ text: "앞뒤까지보존", startFrame: 23, endFrame: 40 }],
          }],
        },
      },
    });

    expect(parsed).not.toBeNull();
    expect(captionRenderSpecForEditor(parsed!).cues[0].words[0].text)
      .toBe("앞뒤까지보존");
  });

  it("lets a lower caption reach the bottom edge without leaving the canvas", () => {
    const lower = {
      ...spec,
      safeArea: { x: 120, y: 1025, width: 840, height: 140 },
    };

    expect(editorCaptionVerticalOffsetBounds(lower, 1.4)).toEqual({
      min: -900,
      max: 717,
    });
  });

  it("rebuilds edited v4 pop captions with canonical advance boxes and gaps", () => {
    const v4 = parseCaptionRenderSpec({
      schemaVersion: 4,
      templateId: "pop",
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
        endFrame: 60,
        words: [
          { text: "기존", startFrame: 0, endFrame: 30 },
          { text: "자막", startFrame: 30, endFrame: 60, spaceBefore: true },
        ],
        events: [{
          startFrame: 0,
          endFrame: 60,
          activeWordIndex: 0,
          positions: [
            { centerX: 470, centerY: 1095, advanceWidth: 120, gapBefore: 0 },
            { centerX: 596, centerY: 1095, advanceWidth: 120, gapBefore: 6 },
          ],
        }],
      }],
    });
    if (!v4 || v4.schemaVersion !== 4) throw new Error("invalid v4 fixture");

    const edited = retimeCaptionRenderSpecForEditor(
      v4,
      [{ id: "whole", sourceStartSeconds: 0, sourceEndSeconds: 2 }],
      [{ cueIndex: 0, text: "수정 자막" }],
      (text, fontSize) => Array.from(text).length * fontSize * 0.5,
    );
    expect(edited?.schemaVersion).toBe(4);
    if (!edited || edited.schemaVersion !== 4) {
      throw new Error("v4 edited spec was downgraded");
    }
    const positions = edited.cues[0]?.events[0]?.positions;
    expect(positions).toHaveLength(2);
    expect(positions?.map((position) => position.gapBefore)).toEqual([0, 6]);
    expect(positions?.[0]?.advanceWidth).toBe(
      Math.round(2 * 72 * 0.5 * 1.12
        * editorCaptionCssToAssScaleById.pretendard * 1_000) / 1_000,
    );
    expect(positions?.every((position) => (
      "advanceWidth" in position
      && Number.isFinite(position.advanceWidth)
      && Math.round(position.advanceWidth * 1_000) === position.advanceWidth * 1_000
    ))).toBe(true);
  });

  it.each(["pop", "highlight"] as const)(
    "recompiles v4 %s geometry for the selected font, size, and safe area",
    (templateId) => {
      const source = v4CaptionFixture(templateId);
      const target = retimeCaptionRenderSpecForEditor(
        source,
        [{ id: "whole", sourceStartSeconds: 0, sourceEndSeconds: 3 }],
        [],
        (text, fontSize) => Array.from(text).length * fontSize * 0.35,
        {
          layout: {
            offsetY: 50,
            scale: 1.1,
            fontId: "paperlogy",
            fontSize: 84,
            color: "#FFD84D",
            accentColor: "#E32626",
          },
        },
      );
      if (!target || target.schemaVersion !== 4) {
        throw new Error("v4 target did not compile");
      }

      expect(target.font).toMatchObject({
        fontId: "paperlogy",
        fileId: "Paperlogy-7Bold.ttf",
        sha256: editorFontSha256ById.paperlogy,
        family: resolveEditorFontFaceV4("paperlogy", "title").family,
        metrics: {
          revision: EDITOR_FONT_METRICS_REVISION,
          cssToAssScale: editorCaptionCssToAssScaleById.paperlogy,
        },
      });
      expect(target.safeArea).toEqual({
        x: 78,
        y: 1068,
        width: 924,
        height: 154,
      });
      expect(target.style).toMatchObject({
        fontSize: 84,
        textColor: "#FFD84D",
        accentColor: "#E32626",
      });
      expect(target.cues.flatMap((cue) => cue.words.map((word) => word.text)))
        .toEqual(["한글", "English", "123"]);
      if (templateId === "pop") {
        expect(target.cues.flatMap((cue) => cue.words.map((word) => word.fontSize)))
          .toEqual([84, 84, 84]);
        expect(target.cues[0].events[0].positions?.[0].advanceWidth).toBe(
          Math.round(
            2 * 84 * 0.35 * 1.12
              * editorCaptionCssToAssScaleById.paperlogy * 1_000,
          ) / 1_000,
        );
      } else {
        expect(target.cues[0]).toMatchObject({
          fontSize: 84,
          centerX: 540,
          centerY: 1145,
        });
      }
    },
  );

  it.each([
    "한글 자막 테스트",
    "English caption fixture",
    "한글 English 123",
  ])("compiles general highlight v4 with exact per-font metrics: %s", (text) => {
    const highlighted = createEditorHighlightCaptionSpec(
      [{ start: 0, end: 3, text }],
      "16:9",
      "#35E6E3",
      "paperlogy",
      (value, fontSize) => Array.from(value).length * fontSize * 0.4,
      { schemaVersion: 4, fontSize: 64 },
    );
    if (!highlighted || highlighted.schemaVersion !== 4) {
      throw new Error("general highlight v4 did not compile");
    }
    expect(highlighted.font).toMatchObject({
      fontId: "paperlogy",
      family: resolveEditorFontFaceV4("paperlogy", "title").family,
      metrics: {
        cssToAssScale: editorCaptionCssToAssScaleById.paperlogy,
      },
    });
    expect(highlighted.style.fontSize).toBe(64);
    expect(highlighted.cues.every((cue) => cue.fontSize === 64)).toBe(true);
    expect(highlighted.cues.flatMap((cue) => cue.words.map((word) => word.text)))
      .toEqual(text.split(" "));
  });

  it("keeps the general highlight compiler on schema v3 by default", () => {
    const highlighted = createEditorHighlightCaptionSpec(
      [{ start: 0, end: 1, text: "기존 강조" }],
      "16:9",
      "#35E6E3",
      "pretendard",
      (text, fontSize) => Array.from(text).length * fontSize * 0.4,
    );
    expect(highlighted?.schemaVersion).toBe(3);
  });
});
