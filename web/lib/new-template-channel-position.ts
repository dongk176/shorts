import type { TemplateId } from "./contracts";
import type { TemplateConfig, UnifiedSubtitleVariant } from "./template-config";
import { builtInSubtitlePresentation } from "./built-in-subtitle-presentation";
import { presetChannelCenterY } from "./preset-channel-position";

/** Only seed new templates; saved custom templates keep their own coordinates. */
export function withNewTemplateChannelPosition<T extends TemplateConfig>(
  config: T,
  templateId: TemplateId,
  subtitleVariant?: UnifiedSubtitleVariant | null,
): T {
  const y = subtitleVariant
    ? builtInSubtitlePresentation({ id: subtitleVariant, videoAspectRatio: config.video.aspectRatio }).config.channel.y
    : presetChannelCenterY(templateId, config.video.aspectRatio);
  return { ...config, channel: { ...config.channel, y } };
}
