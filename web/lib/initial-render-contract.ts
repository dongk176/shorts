import type { VideoAspectRatio } from "@/lib/contracts";
import type { ResolvedTemplateExecutionSnapshot } from "@/lib/template-execution-snapshot";
import {
  createUnifiedSubtitleTemplateConfig,
  type TemplatePresetColor,
} from "@/lib/template-config";
import {
  STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateStyleSnapshot,
  type SubtitleCaptionPlacement,
  type SubtitleTemplateSelectionId,
} from "@/lib/subtitle-templates";

function builtInSubtitleTemplateSnapshot({
  subtitleTemplateId,
  brandColor,
}: {
  subtitleTemplateId: SubtitleTemplateSelectionId;
  brandColor?: TemplatePresetColor;
}) {
  const config = createUnifiedSubtitleTemplateConfig(subtitleTemplateId);
  if (brandColor) {
    config.title.accentColor = brandColor;
    config.subtitle.accentColor = brandColor;
  }
  return {
    presetVersion: 3 as const,
    ...(brandColor ? { brandColor } : {}),
    config,
  };
}

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
  const builtInSubtitleSnapshot = input.subtitleTemplateId
    ? builtInSubtitleTemplateSnapshot({
        subtitleTemplateId: input.subtitleTemplateId,
        brandColor: input.brandColor,
      })
    : null;
  const videoAspectRatio = builtInSubtitleSnapshot
    ? builtInSubtitleSnapshot.config.video.aspectRatio
    : resolved.resolvedVideoAspectRatio;
  const subtitleTemplateSnapshot = input.subtitleTemplateId
    ? subtitleTemplateStyleSnapshot(
        input.subtitleTemplateId,
        videoAspectRatio,
        input.brandColor,
        input.subtitleCaptionPlacement ?? "lower",
        undefined,
        input.enhancedSubtitleTiming
          ? SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES
          : STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
      )
    : resolved.subtitleTemplateSnapshot;
  return {
    templateId: resolved.resolvedTemplateId,
    videoAspectRatio: videoAspectRatio as VideoAspectRatio,
    templateSnapshot: builtInSubtitleSnapshot ?? resolved.templateSnapshot,
    subtitleTemplateId: subtitleTemplateSnapshot?.subtitleTemplateId ?? null,
    subtitleTemplateSnapshot,
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
