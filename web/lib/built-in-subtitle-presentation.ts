import { subtitleChannelRect } from "./preset-channel-position";
import type { VideoAspectRatio } from "./contracts";
import { contrastingTitleTextColor } from "./brand-color-contrast";
import { DEFAULT_EDITOR_FONT_ID, type EditorFontId } from "./editor-fonts";
import {
  createUnifiedSubtitleTemplateConfig,
  type TemplatePresetColor,
} from "./template-config";
import {
  STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  subtitleTemplateStyleSnapshot,
  type SubtitleCaptionPlacement,
  type SubtitleTemplateSelectionId,
} from "./subtitle-templates";

/** Shared by creation previews, job admission and legacy editor reconstruction. */
export function builtInSubtitlePresentation({
  id,
  videoAspectRatio,
  legacyChannelPosition = false,
  captionPlacement = "lower",
  brandColor = SUBTITLE_TEMPLATE_BRAND_COLOR,
  fontId = DEFAULT_EDITOR_FONT_ID,
  timingLeadFrames = STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
}: {
  id: SubtitleTemplateSelectionId;
  legacyChannelPosition?: boolean;
  videoAspectRatio: VideoAspectRatio;
  captionPlacement?: SubtitleCaptionPlacement;
  brandColor?: TemplatePresetColor;
  fontId?: EditorFontId;
  timingLeadFrames?: number;
}) {
  const originalStyle = subtitleTemplateStyleSnapshot(
    id,
    videoAspectRatio,
    brandColor,
    captionPlacement,
    fontId,
    timingLeadFrames,
  );
  const style = legacyChannelPosition ? originalStyle : {
    ...originalStyle,
    layout: {
      ...originalStyle.layout,
      channel: subtitleChannelRect(
        videoAspectRatio, originalStyle.layout.channel, originalStyle.layout.caption,
        originalStyle.channel.iconSizePx,
      ),
    },
  };
  const { layout } = style;
  const config = createUnifiedSubtitleTemplateConfig(id);
  config.video = { ...config.video, ...layout.video, aspectRatio: videoAspectRatio };
  config.title.y = layout.title.y + layout.title.height - style.title.bottomMarginPx
    - (style.title.fontSizePx * 2 + style.title.lineGapPx) / 2;
  config.title.fontId = fontId;
  config.title.accentColor = brandColor;
  config.subtitle.y = layout.caption.y + layout.caption.height / 2;
  config.subtitle.maxWidth = layout.caption.width;
  config.subtitle.fontId = fontId;
  config.subtitle.accentColor = brandColor;
  config.channel.y = layout.channel.y + layout.channel.height / 2;
  if (videoAspectRatio === "9:16") {
    config.title.primaryBackgroundColor = brandColor;
    config.title.accentBackgroundColor = brandColor;
    config.title.primaryColor = contrastingTitleTextColor(brandColor);
    config.title.accentColor = config.title.primaryColor;
  }
  return { config, style };
}
