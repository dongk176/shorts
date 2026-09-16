import { describe, expect, it } from "vitest";
import fixtures from "../../test-fixtures/translated-captions-v4.json";
import { captionCompositionRect } from "./caption-composition";
import { captionRenderSpecForEditor, parseCaptionRenderSpec } from "./caption-render-spec";
import { retimeCaptionRenderSpecForEditor } from "./editor-caption-preview";

describe("saved caption composition", () => {
  it("keeps old projects on their saved layout", () => {
    const spec = parseCaptionRenderSpec(fixtures.en);
    expect(spec).not.toBeNull();
    expect(captionCompositionRect(spec, "comment")).toBeUndefined();
    expect(captionCompositionRect(spec, "title")?.height).toBe(432);
  });

  it("retains separate comment and channel bounds through loading and caption edits", () => {
    const value = structuredClone(fixtures.en);
    const layout = {
      ...value.layout,
      comment: { x: 0, y: 1491, width: 1080, height: 285 },
      channel: { x: 0, y: 1760, width: 1080, height: 160 },
    };
    const spec = parseCaptionRenderSpec({ ...value, layout });
    if (!spec) throw new Error("Invalid fixture");
    const source = captionRenderSpecForEditor(spec);
    const edited = retimeCaptionRenderSpecForEditor(
      source, [{ id: "clip", sourceStartSeconds: 0, sourceEndSeconds: 3 }],
      [{ cueIndex: 0, text: "Hello again." }],
      (text, size) => Array.from(text).length * size * 0.5,
    );
    expect(captionCompositionRect(edited, "comment")).toEqual(layout.comment);
    expect(captionCompositionRect(edited, "channel")).toEqual(layout.channel);
    expect(captionCompositionRect(edited, "video")).toEqual(layout.video);
  });
});
