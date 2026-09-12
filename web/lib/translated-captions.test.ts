import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  captionSpecMatchesTemplate,
  isTranslatedCaptionSpec,
  parseCaptionRenderSpec,
} from "./caption-render-spec";
import { editorCaptionCueText, retimeCaptionRenderSpecForEditor } from "./editor-caption-preview";

const fixtures = JSON.parse(readFileSync(
  new URL("../../test-fixtures/translated-captions-v4.json", import.meta.url), "utf8",
));

describe("translated plain subtitles", () => {
  for (const language of ["en", "ja"]) {
    it(`accepts the worker's ${language} spec and keeps plain captions after cuts and edits`, () => {
      const source = parseCaptionRenderSpec(fixtures[language]);
      expect(source).not.toBeNull();
      if (!source) throw new Error("missing caption fixture");
      expect(isTranslatedCaptionSpec(source)).toBe(true);
      expect(captionSpecMatchesTemplate(source, "pop")).toBe(true);
      expect(captionSpecMatchesTemplate(source, "highlight")).toBe(false);
      for (const edits of [[], [{ cueIndex: 0, text: language === "en"
        ? "The weight is 10.5 kg." : "重さは10.5kgです。" }]]) {
        const result = retimeCaptionRenderSpecForEditor(source, [{
          id: "cut", sourceStartSeconds: 0.5, sourceEndSeconds: 1.8,
        }], edits, (text, size) => Array.from(text).length * size * 0.45);
        expect(result).not.toBeNull();
        expect(result?.templateId).toBe("basic");
        expect(result?.translation).toEqual(source.translation);
        expect(result?.cues.map(editorCaptionCueText).join(" ")).toContain("10.5");
        for (const cue of result?.cues || []) {
          expect(cue.events).toEqual([{ startFrame: cue.startFrame, endFrame: cue.endFrame }]);
        }
        expect(parseCaptionRenderSpec(result)).not.toBeNull();
      }
    });
  }

  it("rejects animation events in a stored basic caption spec", () => {
    const animated = structuredClone(fixtures.en);
    animated.cues[0].events[0].activeWordIndex = 0;
    expect(parseCaptionRenderSpec(animated)).toBeNull();
  });

  it("does not treat an unmarked basic spec as a replacement for a selected template", () => {
    const unmarked = structuredClone(fixtures.en);
    delete unmarked.translation;
    const source = parseCaptionRenderSpec(unmarked);
    expect(source).not.toBeNull();
    if (!source) throw new Error("missing caption fixture");
    expect(captionSpecMatchesTemplate(source, "pop")).toBe(false);
  });
});
