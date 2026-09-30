import type { VideoAspectRatio } from "./contracts";

// Separate, immutable assignments. Public SNS release pointers are never changed.
export const COMMUNITY_TEMPLATE_RELEASE_ID = "0641d236-5e76-467e-95f3-bf695e6d6083";
export const COMMUNITY_EDITOR_RELEASE_ID = "11a62875-b24a-4874-9794-4aac13b0c305";
export const COMMUNITY_GENERATION_RELEASE_IDS = [COMMUNITY_TEMPLATE_RELEASE_ID, "a7db3266-7fc0-4175-a818-39aaff712ad3"] as const;

// Prefer white for the large heading; reserve black for very light backgrounds.
export function communityHeadingColor(background: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(background.trim())?.[1];
  if (!hex) return "#FFFFFF";
  const value = Number.parseInt(hex, 16);
  const brightness = 299 * ((value >> 16) & 255) + 587 * ((value >> 8) & 255) + 114 * (value & 255);
  return brightness >= 210000 ? "#000000" : "#FFFFFF";
}

export const communityVideoFrames: Record<VideoAspectRatio, [number, number, number, number]> = {
  "16:9": [60, 690, 960, 540],
  "5:4": [60, 690, 960, 768],
  "1:1": [60, 690, 960, 960],
  "4:5": [80, 690, 920, 1150],
  "9:16": [216, 690, 648, 1152],
};

export const isCommunityTemplate = (snapshot: Record<string, unknown> | null | undefined) =>
  snapshot?.communityTemplateVersion === 1;
