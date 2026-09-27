import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./editor-fonts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./editor-fonts")>(),
  ensureEditorFontFaceV4Loaded: async () => {},
}));
import { createEditorRenderSpecV4, editorSubtitleLayoutFromRenderSpec } from "./editor-render-spec";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("preserves caption styling through OFF, save, reopen and ON without text edits", async () => {
  vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "true");
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({
    font: "", measureText: (text: string) => ({ width: text.length * 40,
      actualBoundingBoxAscent: 60, actualBoundingBoxDescent: 10 }),
  }) }) });
  const document = JSON.parse(readFileSync(new URL("../../test-fixtures/editor-document-v2.json", import.meta.url), "utf8"));
  const style = { offsetY: -150, scale: 1.25, fontId: "jua" as const, fontSize: 112,
    color: "#00FF00", accentColor: "#FF0000" };
  document.version = 3;
  document.subtitles.enabled = false;
  document.renderSpec = await createEditorRenderSpecV4(document, style);
  expect(editorDocumentSnapshotSchema.safeParse(document).success).toBe(true);
  const saved = JSON.parse(JSON.stringify(document));
  const restored = editorSubtitleLayoutFromRenderSpec(saved.renderSpec);
  expect(restored).toMatchObject(style);
  expect(restored.cueEdits).toBeUndefined();
  saved.subtitles.enabled = true;
  const enabled = await createEditorRenderSpecV4(saved, restored);
  expect(editorSubtitleLayoutFromRenderSpec(enabled)).toEqual(restored);
});
