import { z } from "zod";
import type { CommentOverlay, GeneratedShort } from "./contracts";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { seedEditorOverlayLayoutFromInitialRenderSpec } from "./editor-initial-render-spec";
import type { EditorDocumentSnapshotV3, EditorDocumentJsonObject } from "./editor-document-snapshot";

export const shortsSilenceRequestSchema = z.object({ version: z.literal(1), preset: z.literal("aggressive") }).strict();
export const SHORTS_SILENCE_REQUEST = { version: 1, preset: "aggressive" } as const;
export type SilenceRemovalState = { status: "waiting" | "processing" | "rendering" | "completed" | "failed";
  cutCount: number; removedSeconds: number };

export function canSelectShortsSilence(input: { capability?: boolean; customTemplate: boolean;
  snsTemplate: boolean; outputLanguage: string; sourceLanguage?: string }) {
  return input.capability === true && !input.customTemplate && !input.snsTemplate
    && input.outputLanguage === "ko" && (!input.sourceLanguage || ["auto", "ko"].includes(input.sourceLanguage));
}

export function shortsSilenceEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ADMIN_SHORTS_SILENCE_ENABLED === "true" && env.EASYCUT_ENVIRONMENT !== "lab"
    && Boolean(env.RANKING_VERCEL_SNAPSHOT_ID);
}

/** Sample timestamps are rounded inwards to retain audible boundaries at 30fps. */
export function silenceKeptRanges(start: number, end: number, silences: number[][]): [number, number][] {
  if (![start, end].every(Number.isFinite) || start < 0 || end - start < 1 || end - start > 180) throw new Error("무음 정리 구간이 올바르지 않습니다.");
  let cursor = Math.max(0, Math.ceil(start * 30 - 1e-6));
  const last = Math.floor(end * 30 + 1e-6);
  const result: [number, number][] = [];
  for (const pair of [...silences].sort((a, b) => a[0] - b[0])) {
    if (pair.length !== 2 || !pair.every(Number.isFinite)) throw new Error("무음 분석 결과가 올바르지 않습니다.");
    const left = Math.max(cursor, Math.ceil((pair[0] + .08) * 30));
    const right = Math.min(last, Math.floor((pair[1] - .08) * 30));
    // Keep tiny speech islands instead of dropping a possible syllable.
    if (pair[1] - pair[0] < .3 || right <= left || left - cursor < 5 || last - right < 5) continue;
    result.push([cursor / 30, left / 30]); cursor = right;
    if (result.length >= 119) break;
  }
  result.push([cursor / 30, last / 30]);
  return result.reduce((n, [a, b]) => n + b - a, 0) >= 1 ? result : [[start, end]];
}

export type SilenceEditableShort = Pick<GeneratedShort, "id" | "renderVersion" | "templateId" | "customTemplateId" |
  "templateSnapshot" | "videoAspectRatio" | "hookTitle" | "channelDisplayName" | "titleTextStyles" |
  "initialRenderSpec" | "subtitlesEnabled" | "commentOverlays" | "startSeconds" | "endSeconds">;
export type SilenceTimeline = { start: number; end: number; subtitles: { start: number; end: number; text: string }[] };

export function silenceEditDocument(short: SilenceEditableShort, timeline: SilenceTimeline, silences: number[][]) {
  if (short.renderVersion !== 1 || short.customTemplateId || short.templateSnapshot?.snsTemplateVersion
    || short.initialRenderSpec?.version !== 4) throw new Error("기본·자막 템플릿의 새 쇼츠에서 무음 정리를 사용할 수 있습니다.");
  const ranges = silenceKeptRanges(short.startSeconds - timeline.start, short.endSeconds - timeline.start, silences);
  const outputSeconds = Math.round(ranges.reduce((n, [a, b]) => n + b - a, 0) * 1000) / 1000;
  const outputAt = (t: number) => Math.round(ranges.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0) * 1000) / 1000;
  const sourceOffset = short.startSeconds - timeline.start;
  const comments = short.commentOverlays.flatMap((c): CommentOverlay[] => {
    const startSeconds = outputAt(sourceOffset + c.startSeconds), endSeconds = outputAt(sourceOffset + c.endSeconds);
    return endSeconds - startSeconds >= 1 / 30 ? [{ ...c, startSeconds, endSeconds }] : [];
  });
  const spec = structuredClone(short.initialRenderSpec);
  spec.comments = comments.map(c => ({ id: c.id, offsetY: 0, startFrame: Math.round(c.startSeconds * 30), endFrame: Math.round(c.endSeconds * 30) }));
  const overlays = seedEditorOverlayLayoutFromInitialRenderSpec(createInitialEditorOverlayLayout(), spec);
  overlays.visible.comment = comments.length > 0;
  const document: EditorDocumentSnapshotV3 = {
    version: 3, sourceShortId: short.id, baseRenderVersion: short.renderVersion,
    template: { id: short.templateId, customTemplateId: null,
      presetVersion: Number(short.templateSnapshot?.presetVersion ?? 3), snapshot: short.templateSnapshot as EditorDocumentJsonObject | null },
    title: { text: short.hookTitle, textStyles: short.titleTextStyles, fontScale: 1 },
    channel: { displayName: short.channelDisplayName, thumbnailUrl: null, thumbnailAssetKey: null },
    comments, subtitles: { enabled: short.subtitlesEnabled && Boolean(spec.subtitles), segments: timeline.subtitles },
    overlays, video: { clips: ranges.map(([a, b], i) => ({ id: `silence-cut-${i}`, sourceStartSeconds: a, sourceEndSeconds: b })),
      aspectRatio: short.videoAspectRatio, timelineStartSeconds: timeline.start, timelineEndSeconds: timeline.end,
      selectionStartSeconds: timeline.start + ranges[0][0], selectionEndSeconds: timeline.start + ranges.at(-1)![1] },
    renderSpec: spec,
  };
  return { document: editorDocumentSnapshotSchema.parse(document), cutCount: ranges.length - 1,
    outputSeconds, removedSeconds: Math.round(Math.max(0, short.endSeconds - short.startSeconds - outputSeconds) * 1000) / 1000 };
}
