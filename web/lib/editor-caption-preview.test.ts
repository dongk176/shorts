import { describe, expect, it } from "vitest";
import type { CaptionRenderSpec } from "./caption-render-spec";
import { retimeCaptionRenderSpecForEditor } from "./editor-caption-preview";

const spec: CaptionRenderSpec = {
  schemaVersion: 3,
  templateId: "highlight",
  captionPlacement: "center",
  fps: 30,
  timingLeadFrames: 4,
  safeArea: { x: 120, y: 666, width: 840, height: 140 },
  style: {
    fontSize: 72,
    textColor: "#FFFFFF",
    accentColor: "#35E6E3",
    outlineColor: "#080808",
    outlineWidth: 7,
  },
  cues: [{
    startFrame: 26,
    endFrame: 40,
    fontSize: 72,
    centerX: 540,
    centerY: 736,
    words: [{ text: "선행", startFrame: 26, endFrame: 40 }],
    lines: [[0]],
    events: [{ startFrame: 26, endFrame: 40, activeWordIndex: 0 }],
  }],
};

describe("editor caption preview timing", () => {
  it("keeps the compiled four-frame lead after source clips are retimed", () => {
    const retimed = retimeCaptionRenderSpecForEditor(spec, [{
      id: "clip-a",
      sourceStartSeconds: 0.5,
      sourceEndSeconds: 1.5,
    }]);

    expect(retimed?.timingLeadFrames).toBe(4);
    expect(retimed?.cues[0]?.events[0]).toMatchObject({
      startFrame: 11,
      endFrame: 25,
    });
    // The spoken word starts at source frame 30. In this clip that is output
    // frame 15, so the preview remains exactly four frames early.
    expect(15 - (retimed?.cues[0]?.events[0]?.startFrame || 0)).toBe(4);
  });

  it("drops caption events removed by the edited video clips", () => {
    expect(retimeCaptionRenderSpecForEditor(spec, [{
      id: "clip-b",
      sourceStartSeconds: 2,
      sourceEndSeconds: 3,
    }])).toBeNull();
  });
});
