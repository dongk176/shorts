import type { TemplateId, VideoAspectRatio } from "./contracts";
import { builtInSubtitlePresentation } from "./built-in-subtitle-presentation";
import type { EditorDocumentJsonObject } from "./editor-document-snapshot";
import {
  isTemplateConfigV5,
  templateConfigSchema,
  templatePresetColorOptions,
  type TemplatePresetColor,
} from "./template-config";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  subtitleTemplateCreationIds,
  type SubtitleTemplateSelectionId,
  type SubtitleCaptionPlacement,
} from "./subtitle-templates";

const hexColor = /^#[0-9A-Fa-f]{6}$/;

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function subtitleTemplateSelectionId(
  value: string | null | undefined,
): SubtitleTemplateSelectionId | null {
  return subtitleTemplateCreationIds.find((id) => id === value) || null;
}

function snapshotWithMatchingConfig(
  value: unknown,
  selectionId: SubtitleTemplateSelectionId,
): EditorDocumentJsonObject | null {
  const snapshot = jsonObject(value);
  if (!snapshot) return null;
  const parsedConfig = templateConfigSchema.safeParse(snapshot.config);
  if (
    !parsedConfig.success
    || !isTemplateConfigV5(parsedConfig.data)
    || parsedConfig.data.subtitle.variant !== selectionId
  ) {
    return null;
  }
  return structuredClone({
    ...snapshot,
    config: parsedConfig.data,
  }) as EditorDocumentJsonObject;
}

/**
 * Built-in subtitle templates have a full v5 layout snapshot even though they
 * do not have a custom-template id. Keep that trusted layout in the editor and
 * reconstruct older rows whose first edit accidentally reduced it to only the
 * preset version.
 */
export function resolveBuiltInSubtitleTemplateSnapshot(input: {
  templateId: TemplateId;
  customTemplateId?: string | null;
  subtitleTemplateId?: string | null;
  templateSnapshot?: unknown;
  fallbackTemplateSnapshot?: unknown;
  accentColor?: string | null;
  videoAspectRatio?: VideoAspectRatio;
  captionPlacement?: SubtitleCaptionPlacement;
}): EditorDocumentJsonObject | null {
  const selectionId = subtitleTemplateSelectionId(input.subtitleTemplateId);
  if (
    !selectionId
    || input.customTemplateId
    || input.templateId !== SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID
  ) {
    return null;
  }

  for (const candidate of [
    input.templateSnapshot,
    input.fallbackTemplateSnapshot,
  ]) {
    const snapshot = snapshotWithMatchingConfig(candidate, selectionId);
    if (snapshot) return snapshot;
  }

  const normalizedAccentColor = typeof input.accentColor === "string"
    && hexColor.test(input.accentColor)
    ? input.accentColor.toUpperCase()
    : null;
  const accentColor = normalizedAccentColor
    && templatePresetColorOptions.some(
      (option) => option.color === normalizedAccentColor,
    )
    ? normalizedAccentColor as TemplatePresetColor
    : null;
  const presetVersion = [input.templateSnapshot, input.fallbackTemplateSnapshot].some(
    (snapshot) => snapshot && typeof snapshot === "object" && "presetVersion" in snapshot
      && typeof snapshot.presetVersion === "number" && snapshot.presetVersion >= 4,
  ) ? 4 : 3;
  const { config } = builtInSubtitlePresentation({
    id: selectionId,
    legacyChannelPosition: presetVersion < 4,
    videoAspectRatio: input.videoAspectRatio ?? "16:9",
    captionPlacement: input.captionPlacement,
    brandColor: accentColor ?? undefined,
  });
  return {
    presetVersion,
    ...(accentColor ? { brandColor: accentColor } : {}),
    config,
  } as EditorDocumentJsonObject;
}
