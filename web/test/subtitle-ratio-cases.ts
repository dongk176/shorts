import type { VideoAspectRatio } from "../lib/contracts";

// Independently specified product geometry in the fixed 1080 × 1920 canvas.
export const ratioGeometry: Record<VideoAspectRatio, {
  y: number; height: number; titleY: number; centerY: number; lowerY: number; channelY: number;
}> = {
  "16:9": { y: 432, height: 608, titleY: 295, centerY: 736, lowerY: 1158, channelY: 1790 },
  "5:4": { y: 528, height: 864, titleY: 391, centerY: 960, lowerY: 1253, channelY: 1790 },
  "1:1": { y: 420, height: 1080, titleY: 283, centerY: 960, lowerY: 1344, channelY: 1790 },
  "4:5": { y: 420, height: 1350, titleY: 271, centerY: 1095, lowerY: 1516, channelY: 1690 },
  "9:16": { y: 0, height: 1920, titleY: 271, centerY: 960, lowerY: 1500, channelY: 1790 },
};
export const subtitleRatioCases = (["highlight", "pop"] as const).flatMap((id) =>
  (Object.keys(ratioGeometry) as VideoAspectRatio[]).flatMap((videoAspectRatio) =>
    (["center", "lower"] as const).map((captionPlacement) => ({
      id, videoAspectRatio, captionPlacement,
      ...ratioGeometry[videoAspectRatio],
      captionY: ratioGeometry[videoAspectRatio][captionPlacement === "center" ? "centerY" : "lowerY"],
    })),
  ),
);
