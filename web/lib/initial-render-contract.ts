import type { VideoAspectRatio } from "@/lib/contracts";
import type { ResolvedTemplateExecutionSnapshot } from "@/lib/template-execution-snapshot";
import type { TemplatePresetColor } from "@/lib/template-config";
import {
  STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateStyleSnapshot,
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
  const subtitleTemplateSnapshot = input.subtitleTemplateId
    ? subtitleTemplateStyleSnapshot(
        input.subtitleTemplateId,
        resolved.resolvedVideoAspectRatio,
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
    videoAspectRatio: resolved.resolvedVideoAspectRatio as VideoAspectRatio,
    templateSnapshot: resolved.templateSnapshot,
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
