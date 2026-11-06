import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { seedSnsEditorLayers, unifiedSnsTemplate } from "./unified-sns-editor";

const cases = JSON.parse(readFileSync("../test-fixtures/shorts-silence-social-inline.json", "utf8"));
describe("initial social silence worker/browser parity", () => {
  for (const fixture of cases) {
    it(`opens with matching ${fixture.input.templateSnapshot.communityTemplateVersion ? "community" : "SNS"} geometry and authored copy`, () => {
      const document = editorDocumentSnapshotSchema.parse(fixture.document);
      const config = unifiedSnsTemplate(fixture.input)!.config;
      expect(document.template.snapshot?.config).toMatchObject({
        video: config.video, title: config.title, channel: config.channel,
      });
      const expected = seedSnsEditorLayers(fixture.input);
      expect(document.overlays.layerOrder).toEqual(expected.layerOrder);
      expect(document.overlays.fonts).toEqual(expected.fonts);
      expect(document.overlays.textOverlays).toEqual(expected.textOverlays.map(layer => ({
        ...layer, endSeconds: 2.2,
      })));
      expect(document.template.customTemplateId).toBeNull();
    });
  }
});
