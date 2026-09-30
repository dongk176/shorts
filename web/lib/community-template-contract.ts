import type { VideoAspectRatio } from "./contracts";

// Separate, immutable assignments. Public SNS release pointers are never changed.
export const COMMUNITY_TEMPLATE_RELEASE_ID = "a7db3266-7fc0-4175-a818-39aaff712ad3";
export const COMMUNITY_EDITOR_RELEASE_ID = "601d3d10-62b9-47f2-a34e-78b53ab1ec99";
export const communityVideoFrames: Record<VideoAspectRatio, [number, number, number, number]> = {
  "16:9": [60, 690, 960, 540],
  "5:4": [60, 690, 960, 768],
  "1:1": [60, 690, 960, 960],
  "4:5": [80, 690, 920, 1150],
  "9:16": [216, 690, 648, 1152],
};

export const isCommunityTemplate = (snapshot: Record<string, unknown> | null | undefined) =>
  snapshot?.communityTemplateVersion === 1;
