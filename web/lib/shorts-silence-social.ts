import { silenceEditDocument, type SilenceEditableShort, type SilenceTimeline } from "./shorts-silence-contract";
import { seedSnsEditorLayers, unifiedSnsSnapshot, unifiedSnsTemplate } from "./unified-sns-editor";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { validateUnifiedSnsEdit } from "./unified-sns-editor-validation";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import { compileEditorRenderTitleSpecV4, createEditorRenderSpec } from "./editor-render-spec";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import type { EditorDocumentSnapshotV3 } from "./editor-document-snapshot";

/** Use the same editable social layout as the editor, on its attested worker. */
export async function silenceSocialEditDocument(short: SilenceEditableShort, timeline: SilenceTimeline,
  silences: number[][], release: EditorReleaseAssignment, measurements: Record<string, Record<string, number>>) {
  const template = unifiedSnsTemplate(short);
  if (!template || !release.unifiedTemplateEditingCapable) throw new Error("SILENCE_EDITOR_UNAVAILABLE");
  const original = short.templateSnapshot!;
  const baseSnapshot = { ...original };
  delete baseSnapshot.snsTemplateVersion;
  const plan = silenceEditDocument({ ...short, templateSnapshot: baseSnapshot }, timeline, silences);
  const overlays = seedSnsEditorLayers(short);
  // Semantic overlay bounds must fit the exact retained duration. Rounding
  // upward can exceed the validator boundary by a floating-point fraction.
  const retainedSeconds = plan.document.video.clips.reduce((sum, clip) =>
    sum + clip.sourceEndSeconds - clip.sourceStartSeconds, 0);
  const overlayEnd = Math.floor((retainedSeconds + 1e-9) * 1000) / 1000;
  overlays.textOverlays = overlays.textOverlays.map(layer => ({ ...layer, endSeconds: overlayEnd }));
  const draft: EditorDocumentSnapshotV3 = { ...plan.document, overlays,
    template: { ...plan.document.template, snapshot: unifiedSnsSnapshot(original, template.config, short.hookTitle, overlays.textOverlays) } };
  draft.subtitles.enabled = original.communityTemplateVersion === 1 && plan.document.subtitles.enabled;
  const legacy = createEditorRenderSpec(draft, undefined, 3);
  const title = compileEditorRenderTitleSpecV4(draft, (text, size) => {
    const width = measurements[String(size)]?.[text];
    if (typeof width !== "number" || !Number.isFinite(width) || width < 0) throw new Error("SILENCE_FONT_MEASUREMENTS");
    return { width, actualBoundingBoxAscent: size, actualBoundingBoxDescent: 0 };
  });
  draft.renderSpec = { canvas: legacy.canvas, fps: legacy.fps, version: 4,
    video: legacy.video, comments: legacy.comments, layerOrder: legacy.layerOrder, title,
    channel: { ...legacy.channel, visible: overlays.visible.channel, font: resolveEditorFontFaceV4(overlays.fonts.channel, "channel") },
    textOverlays: legacy.textOverlays.map((layer, i) => ({ ...layer, font: resolveEditorFontFaceV4(overlays.textOverlays[i].fontId, "text") })),
    ...(short.initialRenderSpec?.version === 4 && short.initialRenderSpec.subtitles
      ? { subtitles: structuredClone(short.initialRenderSpec.subtitles) } : {}) };
  const compiled = editorDocumentSnapshotSchema.parse(draft);
  if (compiled.version !== 3) throw new Error("SILENCE_EDITOR_UNAVAILABLE");
  plan.document = compiled;
  plan.document.template.snapshot = validateUnifiedSnsEdit(plan.document, original, short.videoAspectRatio, release);
  const validated = editorDocumentSnapshotSchema.parse(plan.document);
  if (validated.version !== 3) throw new Error("SILENCE_EDITOR_UNAVAILABLE");
  plan.document = validated;
  return plan;
}
