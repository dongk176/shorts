import type { TemplateId, VideoAspectRatio } from "@/lib/contracts";

export function videoAspectRatioForTemplate(value: VideoAspectRatio, templateId: TemplateId) {
  return templateId === "comment-capture" && (value === "4:5" || value === "9:16")
    ? "16:9"
    : value;
}

export function videoAspectRatioSelection(
  value: VideoAspectRatio,
  lockedValue?: VideoAspectRatio,
) {
  return {
    locked: lockedValue !== undefined,
    displayedValue: lockedValue ?? value,
  };
}
