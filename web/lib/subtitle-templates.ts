import type { VideoAspectRatio } from "@/lib/contracts";

export const subtitleTemplateIds = ["basic", "highlight", "pop"] as const;
export type SubtitleTemplateId = typeof subtitleTemplateIds[number];

export const SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID = "dark-minimal" as const;
export const SUBTITLE_TEMPLATE_BRAND_COLOR = "#FF715E" as const;
export const SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES = 4 as const;

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
  "4:5": 285,
  "9:16": 0,
};
const CAPTION_TITLE_OVERLAY = { x: 0, y: 96, width: 1080, height: 300 } as const;
const CAPTION_LANDSCAPE_GAP_PX = 48;

export const subtitleTemplateOptions: Array<{
  id: SubtitleTemplateId;
  name: string;
  description: string;
}> = [
  { id: "basic", name: "자막 기본형", description: "한 줄 문장을 또렷하게" },
  { id: "highlight", name: "자막 강조형", description: "말하는 어절만 브랜드 컬러로" },
  { id: "pop", name: "자막 팝형", description: "핵심 어절을 크고 리듬감 있게" },
];

export function subtitleTemplateLayout(videoAspectRatio: VideoAspectRatio) {
  const videoHeight = CAPTION_VIDEO_HEIGHTS[videoAspectRatio];
  const fullVertical = videoAspectRatio === "9:16";
  const videoY = CAPTION_VIDEO_Y[videoAspectRatio];
  const videoBottom = videoY + videoHeight;
  const safeArea = videoAspectRatio === "16:9"
    ? {
        x: 120,
        y: videoBottom + CAPTION_LANDSCAPE_GAP_PX,
        width: 840,
        height: 140,
      }
    : fullVertical
      ? { x: 120, y: 1430, width: 840, height: 140 }
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
    ? CAPTION_TITLE_OVERLAY
    : { x: 0, y: 0, width: 1080, height: videoY };
  return {
    canvas: { x: 0, y: 0, width: 1080, height: CAPTION_CANVAS_HEIGHT },
    video: { x: 0, y: videoY, width: 1080, height: videoHeight },
    title,
    channel: { x: 0, y: 1710, width: 1080, height: 160 },
    caption: safeArea,
  } as const;
}

export function subtitleTemplateStyleSnapshot(
  id: SubtitleTemplateId,
  videoAspectRatio: VideoAspectRatio,
) {
  const pop = id === "pop";
  const layout = subtitleTemplateLayout(videoAspectRatio);
  return {
    schemaVersion: 3,
    subtitleTemplateId: id,
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
      active: SUBTITLE_TEMPLATE_BRAND_COLOR,
      outline: "#080808",
    },
    outlinePx: pop ? 8 : 7,
    maxLines: 1,
    maxWidthPx: 840,
    popScale: pop ? 1.12 : 1,
    timingLeadFrames: SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
    layout,
    safeArea: layout.caption,
    cueBreak: pop
      ? { maxWords: 3, silenceMs: 250 }
      : { maxLines: 1, silenceMs: 420 },
  } as const;
}
