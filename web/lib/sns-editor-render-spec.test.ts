import { expect, it, vi } from "vitest";
import { createEditorDocumentSnapshotV3 } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { createSnsEditorRenderSpec } from "./sns-editor-render-spec";

vi.mock("./editor-render-spec", async importOriginal => {
  const actual = await importOriginal<typeof import("./editor-render-spec")>();
  return { ...actual, createEditorRenderSpecV4: vi.fn(async () => ({ version: 4, subtitles: { visible: true, captionSpecVersion: 4 } })) };
});
it("omits generic caption settings so a caption-free SNS release can save", async () => {
  const document = createEditorDocumentSnapshotV3({ sourceShortId: "d164fb8d-d6e1-4232-8463-9115cdf7e561", baseRenderVersion: 1,
    template: { id: "white-yellow", customTemplateId: null, presetVersion: 4, snapshot: { snsTemplateVersion: 1 } },
    title: { text: "제목", textStyles: [], fontScale: 1 }, channel: { displayName: "채널", thumbnailUrl: null, thumbnailAssetKey: null },
    comments: [], subtitles: { enabled: false, segments: [] }, overlays: createInitialEditorOverlayLayout(),
    video: { clips: [{ id: "video", sourceStartSeconds: 0, sourceEndSeconds: 5 }], aspectRatio: "9:16", timelineStartSeconds: 0, timelineEndSeconds: 5, selectionStartSeconds: 0, selectionEndSeconds: 5 } });
  const spec = await createSnsEditorRenderSpec(document);
  expect(spec).toEqual({ version: 4 });
  expect(Boolean(spec.subtitles)).toBe(false);
});
