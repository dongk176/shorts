import type { VideoAspectRatio } from "@/lib/contracts";

export function videoAspectRatioSelection(
  value: VideoAspectRatio,
  lockedValue?: VideoAspectRatio,
) {
  return {
    locked: lockedValue !== undefined,
    displayedValue: lockedValue ?? value,
  };
}
