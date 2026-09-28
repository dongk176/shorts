import type { ResolvedTemplateExecutionSnapshot } from "@/lib/template-execution-snapshot";
import type { TemplatePresetColor } from "@/lib/template-config";
import { builtInSubtitlePresentation } from "@/lib/built-in-subtitle-presentation";
import {
  STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  type SubtitleCaptionPlacement,
  type SubtitleTemplateSelectionId,
} from "@/lib/subtitle-templates";

/**
 * The source acquisition path ends before this function. Link and file-upload
 * jobs must persist this exact renderer input contract without branching on
 * `source_type` afterwards.
 */
export function createInitialRenderContract(input: {
  resolvedExecution: ResolvedTemplateExecutionSnapshot;
  subtitleTemplateId?: SubtitleTemplateSelectionId;
  subtitleCaptionPlacement?: SubtitleCaptionPlacement;
  brandColor?: TemplatePresetColor;
  enhancedSubtitleTiming: boolean;
}) {
  const resolved = input.resolvedExecution;
  const presentation = input.subtitleTemplateId
    ? builtInSubtitlePresentation({
        id: input.subtitleTemplateId,
        videoAspectRatio: resolved.resolvedVideoAspectRatio,
        captionPlacement: input.subtitleCaptionPlacement ?? "lower",
        brandColor: input.brandColor,
        timingLeadFrames: input.enhancedSubtitleTiming
          ? SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES
          : STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
      })
    : null;
  const builtInSubtitleSnapshot = presentation
    ? {
        presetVersion: 4 as const,
        ...(input.brandColor ? { brandColor: input.brandColor } : {}),
        config: presentation.config,
      }
    : null;
  const builtInSubtitleStyle = presentation?.style;
  const subtitleTemplateSnapshot = builtInSubtitleStyle
    ? {
        ...builtInSubtitleStyle,
        schemaVersion: 4 as const,
        origin: "unified-template-v5" as const,
        enabled: builtInSubtitleSnapshot?.config.subtitle.visible ?? true,
      }
    : resolved.subtitleTemplateSnapshot;
  return {
    templateId: resolved.resolvedTemplateId,
    videoAspectRatio: resolved.resolvedVideoAspectRatio,
    templateSnapshot: builtInSubtitleSnapshot ?? resolved.templateSnapshot,
    subtitleTemplateId: subtitleTemplateSnapshot?.subtitleTemplateId ?? null,
    subtitleTemplateSnapshot,
    usesUnifiedTemplateSubtitleCandidate: Boolean(
      builtInSubtitleStyle || resolved.usesUnifiedTemplateSubtitleCanary,
    ),
  };
}

export function canonicalInitialRenderContract(
  contract: ReturnType<typeof createInitialRenderContract>,
) {
  return JSON.stringify({
    templateId: contract.templateId,
    videoAspectRatio: contract.videoAspectRatio,
    templateSnapshot: contract.templateSnapshot,
    subtitleTemplateId: contract.subtitleTemplateId,
    subtitleTemplateSnapshot: contract.subtitleTemplateSnapshot,
  });
}
