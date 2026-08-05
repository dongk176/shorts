import { fitPreviewTitleFont, wrapPreviewTitle } from "@/lib/title-preview";
import {
  resolveEditorFontFace,
  type ResolvedEditorFontFace,
} from "@/lib/editor-fonts";
import type { EditorDocumentSnapshotV2 } from "@/lib/editor-document-snapshot";
import type { TemplatePresetColor } from "@/lib/template-config";

export const EDITOR_RENDER_SPEC_VERSION = 1 as const;
export const EDITOR_RENDER_CANVAS = { width: 1080, height: 1920 } as const;
export const EDITOR_RENDER_FPS = 30 as const;

export type EditorRenderTextLayerSpec = {
  id: string;
  lines: string[];
  centerX: number;
  centerY: number;
  width: number;
  fontSize: 72;
  lineHeight: 86;
  scale: number;
  color: TemplatePresetColor;
  effect: "none" | "outline" | "shadow";
  outlineWidth: 0 | 10;
  shadowBlur: 0 | 13;
  startFrame: number;
  endFrame: number;
  font: ResolvedEditorFontFace;
};

export type EditorRenderSpec = {
  version: typeof EDITOR_RENDER_SPEC_VERSION;
  canvas: typeof EDITOR_RENDER_CANVAS;
  fps: typeof EDITOR_RENDER_FPS;
  layerOrder: string[];
  title: {
    lines: string[];
    centerX: 540;
    offsetY: number;
    fontSize: number;
    scale: 1;
    font: ResolvedEditorFontFace;
  };
  channel: {
    offsetX: number;
    offsetY: number;
    scale: number;
    font: ResolvedEditorFontFace;
  };
  comments: Array<{
    id: string;
    offsetY: number;
    startFrame: number;
    endFrame: number;
  }>;
  textOverlays: EditorRenderTextLayerSpec[];
  video: {
    offsetX: number;
    offsetY: number;
    scale: number;
  };
};

function frameAt(seconds: number) {
  return Math.max(0, Math.round(seconds * EDITOR_RENDER_FPS));
}

function estimatedCharacterWidth(character: string, fontSize: number) {
  if (/\s/u.test(character)) return fontSize * 0.28;
  if (/\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
    return fontSize;
  }
  if (/\p{Extended_Pictographic}/u.test(character)) return fontSize;
  if (/[A-Z]/.test(character)) return fontSize * 0.68;
  if (/[a-z]/.test(character)) return fontSize * 0.56;
  if (/[0-9]/.test(character)) return fontSize * 0.62;
  return fontSize * 0.45;
}

export function wrapEditorRenderText(
  value: string,
  width: number,
  fontSize = 72,
) {
  const maximumWidth = Math.max(1, width - 44);
  const lines: string[] = [];
  for (const paragraph of (value || "텍스트").split("\n")) {
    let current = "";
    let currentWidth = 0;
    for (const character of Array.from(paragraph)) {
      const characterWidth = estimatedCharacterWidth(character, fontSize);
      if (current && currentWidth + characterWidth > maximumWidth) {
        lines.push(current.trimEnd());
        current = character.trimStart();
        currentWidth = current
          ? estimatedCharacterWidth(current, fontSize)
          : 0;
      } else {
        current += character;
        currentWidth += characterWidth;
      }
    }
    lines.push(current || " ");
  }
  return lines.slice(0, 20);
}

export function createEditorRenderSpec(
  document: Omit<EditorDocumentSnapshotV2, "version" | "overlays"> & {
    overlays: Omit<EditorDocumentSnapshotV2["overlays"], "layerOrder"> & {
      layerOrder: string[];
    };
  },
): EditorRenderSpec {
  const titleLines = wrapPreviewTitle(document.title.text);
  const snapshotConfig = document.template.snapshot?.config;
  const snapshotTitle = snapshotConfig
    && typeof snapshotConfig === "object"
    && !Array.isArray(snapshotConfig)
    && snapshotConfig.title
    && typeof snapshotConfig.title === "object"
    && !Array.isArray(snapshotConfig.title)
    ? snapshotConfig.title
    : null;
  const customTitleFontSize = snapshotTitle
    && typeof snapshotTitle.fontSize === "number"
    ? snapshotTitle.fontSize
    : null;
  const titleFontSize = Math.max(
    18,
    Math.min(
      200,
      Math.round(
        (customTitleFontSize || fitPreviewTitleFont(titleLines))
        * document.title.fontScale,
      ),
    ),
  );
  return {
    version: EDITOR_RENDER_SPEC_VERSION,
    canvas: EDITOR_RENDER_CANVAS,
    fps: EDITOR_RENDER_FPS,
    layerOrder: [...document.overlays.layerOrder],
    title: {
      lines: titleLines,
      centerX: 540,
      offsetY: document.overlays.offsets.title.y,
      fontSize: titleFontSize,
      scale: 1 as const,
      font: resolveEditorFontFace(document.overlays.fonts.title, "title"),
    },
    channel: {
      offsetX: document.overlays.offsets.channel.x,
      offsetY: document.overlays.offsets.channel.y,
      scale: document.overlays.scales.channel,
      font: resolveEditorFontFace(document.overlays.fonts.channel, "channel"),
    },
    comments: document.comments.map((comment) => ({
      id: comment.id,
      offsetY: (
        document.overlays.commentOffsets[comment.id]
        || document.overlays.offsets.comment
      ).y,
      startFrame: frameAt(comment.startSeconds),
      endFrame: frameAt(comment.endSeconds),
    })),
    textOverlays: document.overlays.textOverlays.map((overlay) => ({
      id: overlay.id,
      lines: wrapEditorRenderText(overlay.text, overlay.width),
      centerX: 540 + overlay.offset.x,
      centerY: 960 + overlay.offset.y,
      width: overlay.width,
      fontSize: 72,
      lineHeight: 86,
      scale: overlay.scale,
      color: overlay.color,
      effect: overlay.effect,
      outlineWidth: overlay.effect === "outline" ? 10 : 0,
      shadowBlur: overlay.effect === "shadow" ? 13 : 0,
      startFrame: frameAt(overlay.startSeconds),
      endFrame: frameAt(overlay.endSeconds),
      font: resolveEditorFontFace(overlay.fontId, "text"),
    })),
    video: {
      offsetX: document.overlays.offsets.video.x,
      offsetY: document.overlays.offsets.video.y,
      scale: document.overlays.scales.video,
    },
  };
}
