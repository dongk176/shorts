import type { TemplateId, VideoAspectRatio } from "./contracts";

export const CHANNEL_POSITION_PRESET_VERSION = 4;
const generalCenters: Record<VideoAspectRatio, number> = {
  "16:9": 1400, "5:4": 1520, "1:1": 1620, "4:5": 1520, "9:16": 1520,
};
const commentCenters: Record<VideoAspectRatio, number> = {
  "16:9": 1464, "5:4": 1752, "1:1": 1824, "4:5": 1840, "9:16": 1840,
};

/** Version 3 and older projects retain their original render/edit origin. */
export function presetChannelCenterY(
  id: TemplateId, ratio: VideoAspectRatio, presetVersion = CHANNEL_POSITION_PRESET_VERSION,
) {
  if (presetVersion < CHANNEL_POSITION_PRESET_VERSION) {
    return id === "comment-capture" ? 1840 : 1580;
  }
  return (id === "comment-capture" ? commentCenters : generalCenters)[ratio];
}

export function subtitleChannelRect(
  ratio: VideoAspectRatio,
  channel: { x: number; y: number; width: number; height: number },
  caption: { y: number; height: number },
  iconSize: number,
) {
  const preferredCenter = ratio === "16:9" ? 1368 : ratio === "1:1" ? 1620 : 1508;
  const center = Math.max(preferredCenter, caption.y + caption.height + 72 + iconSize / 2);
  return { ...channel, y: center - channel.height / 2 };
}
