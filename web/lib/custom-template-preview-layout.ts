import { TEMPLATE_CANVAS, type TemplateConfig } from "@/lib/template-config";

type CenteredLayer = Pick<TemplateConfig["title"], "x" | "y" | "maxWidth">;
export type VideoPreviewFrame = Pick<
  TemplateConfig["video"],
  "x" | "y" | "width" | "height"
>;

export const CUSTOM_COMMENT_Y_MIN = 720;
export const CUSTOM_COMMENT_Y_MAX = 1480;

function percent(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

export function customVideoFrameStyle(video: VideoPreviewFrame) {
  return {
    left: percent(video.x, TEMPLATE_CANVAS.width),
    top: percent(video.y, TEMPLATE_CANVAS.height),
    width: percent(video.width, TEMPLATE_CANVAS.width),
    height: percent(video.height, TEMPLATE_CANVAS.height),
  };
}

export function resolveEditorVideoPreviewFrame({
  customTemplateConfig,
  captionVideoFrame,
  fallbackFrame,
}: {
  customTemplateConfig: TemplateConfig | null;
  captionVideoFrame: VideoPreviewFrame | null;
  fallbackFrame: VideoPreviewFrame;
}): VideoPreviewFrame {
  if (customTemplateConfig?.schemaVersion === 5) {
    return customTemplateConfig.video;
  }
  return captionVideoFrame
    || customTemplateConfig?.video
    || fallbackFrame;
}

export function customCenteredLayerStyle(layer: CenteredLayer) {
  return {
    left: percent(layer.x, TEMPLATE_CANVAS.width),
    top: percent(layer.y, TEMPLATE_CANVAS.height),
    width: percent(layer.maxWidth, TEMPLATE_CANVAS.width),
    transform: "translate(-50%, -50%)",
  };
}

export function customCanvasWidth(value: number) {
  return `${(value / TEMPLATE_CANVAS.width) * 100}cqw`;
}

export function customCommentCanDockToVideo(video: TemplateConfig["video"]) {
  const videoBottom = video.y + video.height;
  return videoBottom >= CUSTOM_COMMENT_Y_MIN && videoBottom <= CUSTOM_COMMENT_Y_MAX;
}

export function customCommentLayerY(config: Pick<TemplateConfig, "video" | "comment">) {
  const videoBottom = config.video.y + config.video.height;
  return config.comment.dockedToVideo && customCommentCanDockToVideo(config.video)
    ? videoBottom
    : config.comment.y;
}
