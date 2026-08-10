import type { TitleTextStyle, VideoAspectRatio } from "@/lib/contracts";
import type { TemplatePresetColor } from "@/lib/template-config";
import { ensureTitleTextBackground } from "@/lib/title-text-style";

export const subtitleTemplateIds = ["basic", "highlight", "pop"] as const;
export type SubtitleTemplateId = typeof subtitleTemplateIds[number];
export const subtitleTemplateCreationIds = [
  "pop",
  "highlight",
] as const;
export type SubtitleTemplateSelectionId = typeof subtitleTemplateCreationIds[number];
export const subtitleCaptionPlacements = ["lower", "center"] as const;
export type SubtitleCaptionPlacement = typeof subtitleCaptionPlacements[number];

export const SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID = "dark-minimal" as const;
export const SUBTITLE_TEMPLATE_BRAND_COLOR = "#35E6E3" as const;
export const SUBTITLE_TEMPLATE_TITLE_SECOND_LINE_COLOR = "#35E6E3" as const;
export const SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES = 7 as const;
export const SUBTITLE_TEMPLATE_POP_WORD_GAP_PX = 6 as const;
export const SUBTITLE_TEMPLATE_TITLE_FONT_SIZE_PX = 84 as const;
export const SUBTITLE_TEMPLATE_TITLE_LINE_GAP_PX = 18 as const;

const CAPTION_CANVAS_HEIGHT = 1920;
const CAPTION_VIDEO_HEIGHTS: Record<VideoAspectRatio, number> = {
  "16:9": 608,
  "5:4": 864,
  "1:1": 1080,
  "4:5": 1350,
  "9:16": 1920,
};
const CAPTION_VIDEO_Y: Record<VideoAspectRatio, number> = {
  // Keep the established comment-capture stack, with the landscape video
  // pulled up another 64px so its title and caption can both sit closer.
  "16:9": 432,
  "5:4": 528,
  "1:1": 420,
  "4:5": 420,
  "9:16": 0,
};
const CAPTION_FULL_VERTICAL_TITLE_OVERLAY = {
  x: 0,
  y: 96,
  width: 1080,
  height: 300,
} as const;
const CAPTION_LANDSCAPE_GAP_PX = 48;
const CAPTION_PORTRAIT_CHANNEL_GAP_PX = 24;
const CAPTION_CHANNEL_HEIGHT_PX = 160;

export const subtitleTemplateOptions: Array<{
  id: SubtitleTemplateSelectionId;
  name: string;
  description: string;
}> = [
  { id: "pop", name: "자막 팝형", description: "핵심 어절을 크고 리듬감 있게" },
  { id: "highlight", name: "자막 강조형", description: "말하는 어절만 브랜드 컬러로" },
];

export function subtitleTemplateTitleTextStyles(
  title: string,
  videoAspectRatio: VideoAspectRatio,
  brandColor: TemplatePresetColor,
  currentStyles: TitleTextStyle[] = [],
) {
  if (videoAspectRatio !== "9:16") {
    return currentStyles.map((style) => ({ ...style }));
  }
  return ensureTitleTextBackground(title, currentStyles, brandColor);
}

export function subtitleTemplateLayout(
  videoAspectRatio: VideoAspectRatio,
  captionPlacement: SubtitleCaptionPlacement = "lower",
) {
  const videoHeight = CAPTION_VIDEO_HEIGHTS[videoAspectRatio];
  const fullVertical = videoAspectRatio === "9:16";
  const videoY = CAPTION_VIDEO_Y[videoAspectRatio];
  const videoBottom = videoY + videoHeight;
  const channel = videoAspectRatio === "4:5"
    ? {
        x: 0,
        y: videoBottom - CAPTION_CHANNEL_HEIGHT_PX,
        width: 1080,
        height: CAPTION_CHANNEL_HEIGHT_PX,
      }
    : { x: 0, y: 1710, width: 1080, height: CAPTION_CHANNEL_HEIGHT_PX };
  const safeArea = captionPlacement === "center"
    ? {
        x: 120,
        y: videoY + Math.round((videoHeight - 140) / 2),
        width: 840,
        height: 140,
      }
    : videoAspectRatio === "16:9"
    ? {
        x: 120,
        y: videoBottom + CAPTION_LANDSCAPE_GAP_PX,
        width: 840,
        height: 140,
      }
    : fullVertical
      ? { x: 120, y: 1430, width: 840, height: 140 }
      : videoAspectRatio === "4:5"
        ? {
            x: 120,
            y: channel.y - CAPTION_PORTRAIT_CHANNEL_GAP_PX - 140,
            width: 840,
            height: 140,
          }
      : {
        x: 120,
        y: Math.max(
          videoY,
          videoBottom - Math.max(64, Math.round(videoHeight * 0.08)) - 140,
        ),
        width: 840,
        height: 140,
      };
  const title = videoAspectRatio === "4:5" || fullVertical
    ? CAPTION_FULL_VERTICAL_TITLE_OVERLAY
    : { x: 0, y: 0, width: 1080, height: videoY };
  return {
    canvas: { x: 0, y: 0, width: 1080, height: CAPTION_CANVAS_HEIGHT },
    video: { x: 0, y: videoY, width: 1080, height: videoHeight },
    title,
    channel,
    caption: safeArea,
  } as const;
}

export function subtitleTemplateStyleSnapshot(
  id: SubtitleTemplateSelectionId,
  videoAspectRatio: VideoAspectRatio,
  brandColor: TemplatePresetColor = SUBTITLE_TEMPLATE_BRAND_COLOR,
  captionPlacement: SubtitleCaptionPlacement = "lower",
) {
  const subtitleTemplateId = id;
  const pop = subtitleTemplateId === "pop";
  const layout = subtitleTemplateLayout(videoAspectRatio, captionPlacement);
  const titleBottomMarginPx = Math.min(
    44,
    Math.max(24, Math.round(layout.title.height * 0.105)),
  );
  return {
    schemaVersion: 3,
    subtitleTemplateId,
    selectionId: id,
    captionPlacement,
    baseTemplateId: SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
    videoAspectRatio,
    fps: 30,
    font: {
      id: "pretendard-bold",
      family: "Pretendard",
      weight: 700,
      sizePx: pop ? 92 : 72,
      minSizePx: pop ? 64 : 72,
    },
    color: {
      text: "#FFFFFF",
      active: brandColor,
      outline: "#080808",
    },
    title: {
      fontSizePx: SUBTITLE_TEMPLATE_TITLE_FONT_SIZE_PX,
      lineGapPx: SUBTITLE_TEMPLATE_TITLE_LINE_GAP_PX,
      bottomMarginPx: titleBottomMarginPx,
      firstLineColor: "#FFFFFF",
      secondLineColor: brandColor,
    },
    channel: {
      fontSizePx: 48,
      iconSizePx: 64,
      gapPx: 26,
    },
    outlinePx: pop ? 8 : 7,
    maxLines: 1,
    maxWidthPx: 840,
    popScale: pop ? 1.12 : 1,
    wordGapPx: pop ? SUBTITLE_TEMPLATE_POP_WORD_GAP_PX : 0,
    timingLeadFrames: SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
    layout,
    safeArea: layout.caption,
    cueBreak: pop
      ? { maxWords: 3, silenceMs: 250 }
      : { maxLines: 1, silenceMs: 420 },
  } as const;
}
