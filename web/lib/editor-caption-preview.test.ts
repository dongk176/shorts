import { describe, expect, it } from "vitest";
import {
  captionRenderSpecForEditor,
  parseCaptionRenderSpec,
  type CaptionRenderSpec,
} from "./caption-render-spec";
import {
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

describe("editor caption preview timing", () => {
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

  it("assigns a word crossing deleted split content to one output clip only", () => {
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
      { id: "left", sourceStartSeconds: 0, sourceEndSeconds: 0.9 },
      { id: "right", sourceStartSeconds: 2, sourceEndSeconds: 3 },
    ]);

    expect(retimed?.cues.flatMap((cue) => cue.words).map((word) => word.text))
      .toEqual(["경계단어"]);
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
});
