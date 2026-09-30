import { createEditorRenderSpecV4, type EditorRenderDocumentInput } from "./editor-render-spec";

export async function createSnsEditorRenderSpec(document: EditorRenderDocumentInput) {
  const spec = await createEditorRenderSpecV4(document);
  // SNS copy belongs to the post snapshot; it has no timeline-caption controls.
  delete spec.subtitles;
  return spec;
}
