import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import { wrapPreviewTitle } from "./title-preview";
import { compileEditorRenderTitleSpecV4 } from "./editor-render-spec";
vi.mock("server-only", () => ({}));
import fixture from "../../test-fixtures/unified-social-editor-v4.json";
import { silenceEditDocument, type SilenceEditableShort } from "./shorts-silence-contract";
import { silenceSocialEditDocument } from "./shorts-silence-social";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { UNIFIED_SNS_EDITOR_RELEASE_ID, UNIFIED_COMMUNITY_EDITOR_RELEASE_ID } from "./unified-sns-editor";

function input(): SilenceEditableShort {
  const doc = editorDocumentSnapshotSchema.parse(structuredClone(fixture));
  if (doc.version !== 3) throw new Error("fixture version");
  return { id: doc.sourceShortId, renderVersion: 1, templateId: doc.template.id,
    customTemplateId: null, templateSnapshot: doc.template.snapshot, videoAspectRatio: "16:9",
    hookTitle: doc.title.text, channelDisplayName: doc.channel.displayName,
    titleTextStyles: [], initialRenderSpec: doc.renderSpec, subtitlesEnabled: false,
    commentOverlays: [], startSeconds: 240, endSeconds: 252 };
}
const timeline = { start: 240, end: 252, subtitles: [] };
describe("silence removal preserves editable template layers", () => {
  it("keeps custom identity and removes only layers wholly inside the cut", () => {
    const short = input();
    short.customTemplateId = "11111111-1111-4111-8111-111111111111";
    delete short.templateSnapshot!.snsTemplateVersion;
    const spec = short.initialRenderSpec!;
    const layer = spec.textOverlays[0];
    spec.textOverlays = [{ ...layer, id: "whole", startFrame: 0, endFrame: 360 },
      { ...layer, id: "silent", startFrame: 100, endFrame: 140 }];
    spec.layerOrder = ["video", "title", "comment", "text:whole", "text:silent", "channel"];
    const original = structuredClone(short);
    const plan = silenceEditDocument(short, timeline, [[3, 5]]);
    expect(plan.document.template.customTemplateId).toBe(short.customTemplateId);
    expect(plan.document.overlays.textOverlays.map(l => l.id)).toEqual(["whole"]);
    expect(plan.document.overlays.textOverlays[0].endSeconds).toBeCloseTo(plan.outputSeconds, 2);
    expect(plan.document.renderSpec.layerOrder).not.toContain("text:silent");
    expect(short).toEqual(original);
  });
  it("keeps social text within a fractional retained duration", async () => {
    const short = input();
    short.endSeconds = 278.2;
    const texts = [...new Set(wrapPreviewTitle(short.hookTitle).flatMap(line => [line, ...line.split(" ")]))];
    const measurements = Object.fromEntries(Array.from({ length: 183 }, (_, i) => [String(i + 18),
      Object.fromEntries(texts.map(text => [text, text.length * (i + 18) * .5]))]));
    const plan = await silenceSocialEditDocument(short, { start: 240, end: 278.2, subtitles: [] },
      [[2.336599, 2.677279], [19.93254, 20.453469], [33.923628, 35.592222]],
      { channel: "canary", releaseId: UNIFIED_SNS_EDITOR_RELEASE_ID, uiVersion: 3,
        documentVersion: 3, unifiedTemplateEditingCapable: true,
        subtitleEditingCapable: true, subtitleEditingPublicEnabled: false }, measurements);
    const actualDuration = plan.document.video.clips.reduce((sum, clip) =>
      sum + clip.sourceEndSeconds - clip.sourceStartSeconds, 0);
    expect(plan.cutCount).toBe(3);
    for (const text of plan.document.overlays.textOverlays) {
      expect(text.endSeconds).toBeLessThanOrEqual(actualDuration + 1e-9);
      expect(actualDuration - text.endSeconds).toBeLessThan(.0011);
    }
    expect(() => editorDocumentSnapshotSchema.parse(plan.document)).not.toThrow();
  });
  it.each(["ko", "en", "ja"])("preserves social copy and duration in %s", async language => {
    for (const community of [false, true]) {
      const short = input();
      short.hookTitle = language === "ja" ? "一緒に編集する" : language === "en" ? "Edit together" : "함께 편집해요";
      short.initialRenderSpec!.textOverlays = short.initialRenderSpec!.textOverlays.map(layer => ({ ...layer, startFrame: 0, endFrame: 360 }));
      short.templateSnapshot!.snsLanguage = language;
      if (community) short.templateSnapshot!.communityTemplateVersion = 1;
      const release = { channel: "canary" as const,
        releaseId: community ? UNIFIED_COMMUNITY_EDITOR_RELEASE_ID : UNIFIED_SNS_EDITOR_RELEASE_ID,
        uiVersion: 3, documentVersion: 3, unifiedTemplateEditingCapable: true,
        subtitleEditingCapable: true, subtitleEditingPublicEnabled: false };
      const root = path.resolve(import.meta.dirname, "../..");
      const face = resolveEditorFontFaceV4(language === "ja" ? "noto-sans-jp" : "pretendard", "title");
      const texts = [...new Set(wrapPreviewTitle(short.hookTitle).flatMap(line => [line, ...line.split(" ")]))];
      const measurements = JSON.parse(execFileSync(path.join(root, "worker/.venv/bin/python"), ["-c", `
import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('analyzer',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.measure_title(json.loads(sys.argv[2]),Path(sys.argv[3]))))
`, path.join(root, "web/private/shorts-silence/analyze.py"), JSON.stringify({ texts, sha256: face.sha256, variableWeight: face.variableWeight }), path.join(root, "web/public/fonts/editor", face.fileId)], { encoding: "utf8", timeout: 30_000 }));
      const initialDocument = editorDocumentSnapshotSchema.parse(structuredClone(fixture));
      initialDocument.title.text = short.hookTitle;
      initialDocument.overlays.fonts.title = face.fontId;
      short.initialRenderSpec!.title = compileEditorRenderTitleSpecV4(initialDocument, (text, size) => ({
        width: measurements[String(size)][text], actualBoundingBoxAscent: size, actualBoundingBoxDescent: 0,
      }));
      const plan = await silenceSocialEditDocument(short, timeline, [[3, 5]], release, measurements);
      expect(plan.cutCount).toBe(1);
      expect(plan.document.template.snapshot!.snsLanguage).toBe(language);
      expect(plan.document.overlays.textOverlays.every(l => Math.abs(l.endSeconds - plan.outputSeconds) < .001)).toBe(true);
      expect(plan.document.renderSpec.textOverlays.length).toBeGreaterThan(0);
      expect(plan.document.template.customTemplateId).toBeNull();
      const folder = mkdtempSync(path.join(os.tmpdir(), "silence-social-media-"));
      const python = path.join(root, "worker/.venv/bin/python");
      const helper = path.join(root, "test-tools/silence-media-proof.py");
      try {
        execFileSync(python, [helper, "prepare", folder, "240", language], { timeout: 120_000 });
        writeFileSync(path.join(folder, "plan.json"), JSON.stringify(plan));
        const result = JSON.parse(execFileSync(python, [helper, "render", folder], { encoding: "utf8", timeout: 120_000 }));
        expect(result.outputSeconds).toBeCloseTo(plan.outputSeconds, 1);
        expect(result.codecs).toEqual(expect.arrayContaining(["h264", "aac"]));
      } finally { rmSync(folder, { recursive: true, force: true }); }
    }
  }, 180_000);
});
