import type {
  TemplateId,
  TitleTextStyle,
  VideoAspectRatio,
} from "@/lib/contracts";
import type { EditorDocumentJsonObject } from "@/lib/editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "@/lib/editor-overlay-preview";
import type { EditorRenderDocumentInput } from "@/lib/editor-render-spec";
import {
  DEFAULT_EDITOR_FONT_ID,
  type EditorFontId,
} from "@/lib/editor-fonts";
import {
  isTemplateConfigV5,
  templatePresetPresentation,
  type TemplateConfig,
} from "@/lib/template-config";

const TEMPLATE_TITLE_PREVIEW_SOURCE_ID = "template-title-v4-preview";

export type TemplateTitleV4DocumentInput = {
  templateId: TemplateId;
  title: string;
  templateConfig?: TemplateConfig | null;
  videoAspectRatio?: VideoAspectRatio;
  textStyles?: TitleTextStyle[];
  fontId?: EditorFontId;
};

function templateConfigSnapshot(config: TemplateConfig) {
  return {
    config: structuredClone(config),
  } as unknown as EditorDocumentJsonObject;
}

/**
 * Builds the smallest editor document that still carries every input used by
 * the authoritative v4 title compiler. Template previews must compile this
 * document instead of recreating title position, fitting, or spacing in CSS.
 */
export function createTemplateTitleV4DocumentInput({
  templateId,
  title,
  templateConfig = null,
  videoAspectRatio,
  textStyles = [],
  fontId,
}: TemplateTitleV4DocumentInput): EditorRenderDocumentInput {
  const overlays = createInitialEditorOverlayLayout();
  const resolvedFontId = fontId
    ?? (templateConfig && isTemplateConfigV5(templateConfig)
      ? templateConfig.title.fontId
      : DEFAULT_EDITOR_FONT_ID);
  overlays.fonts.title = resolvedFontId;
  overlays.visible.title = templateConfig?.title.visible !== false;
  overlays.visible.channel = templateConfig?.channel.visible !== false;
  const aspectRatio = templateConfig?.video.aspectRatio
    ?? videoAspectRatio
    ?? templatePresetPresentation[templateId].videoAspectRatio;

  return {
    sourceShortId: TEMPLATE_TITLE_PREVIEW_SOURCE_ID,
    baseRenderVersion: 1,
    template: {
      id: templateId,
      customTemplateId: templateConfig ? TEMPLATE_TITLE_PREVIEW_SOURCE_ID : null,
      presetVersion: 3,
      snapshot: templateConfig
        ? templateConfigSnapshot(templateConfig)
        : { presetVersion: 3 },
    },
    title: {
      text: title,
      textStyles: textStyles.map((style) => ({ ...style })),
      fontScale: 1,
    },
    channel: {
      displayName: "Easy Cut",
      thumbnailUrl: null,
      thumbnailAssetKey: null,
    },
    comments: [],
    subtitles: {
      enabled: false,
      segments: [],
    },
    overlays,
    video: {
      clips: [{
        id: TEMPLATE_TITLE_PREVIEW_SOURCE_ID,
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
      }],
      aspectRatio,
      timelineStartSeconds: 0,
      timelineEndSeconds: 1,
      selectionStartSeconds: 0,
      selectionEndSeconds: 1,
    },
  };
}
