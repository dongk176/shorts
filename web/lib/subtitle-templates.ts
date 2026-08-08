import type { VideoAspectRatio } from "@/lib/contracts";

export const subtitleTemplateIds = ["basic", "highlight", "pop"] as const;
export type SubtitleTemplateId = typeof subtitleTemplateIds[number];

export const SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID = "dark-minimal" as const;
export const SUBTITLE_TEMPLATE_BRAND_COLOR = "#FF715E" as const;

export const subtitleTemplateOptions: Array<{
  id: SubtitleTemplateId;
  name: string;
  description: string;
}> = [
  { id: "basic", name: "자막 기본형", description: "문장을 또렷하게 두 줄까지" },
  { id: "highlight", name: "자막 강조형", description: "말하는 어절만 브랜드 컬러로" },
  { id: "pop", name: "자막 팝형", description: "핵심 어절을 크고 리듬감 있게" },
];

export function subtitleTemplateStyleSnapshot(
  id: SubtitleTemplateId,
  videoAspectRatio: VideoAspectRatio,
) {
  const pop = id === "pop";
  return {
    schemaVersion: 1,
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
    maxLines: pop ? 1 : 2,
    maxWidthPx: 840,
    popScale: pop ? 1.12 : 1,
    safeArea: videoAspectRatio === "9:16"
      ? { x: 120, y: 1220, width: 840, height: 290 }
      : {
          horizontalInsetPx: 120,
          bottomOffsetVideoRatio: 0.08,
          maxHeightPx: 250,
        },
    cueBreak: pop
      ? { maxWords: 3, silenceMs: 250 }
      : { maxLines: 2, silenceMs: 420 },
  } as const;
}
