import type { CSSProperties } from "react";

export type ChannelRect = { x: number; y: number; width: number; height: number };
export type ChannelContrastContextValue = {
  video: ChannelRect;
  offset?: { x: number; y: number };
  scale?: number;
};
// Keep in sync with worker/channel_contrast.py. An explicit background wins.
export function channelContrastColor(foreground: string): string {
  const rgb = foreground.replace("#", "");
  const channels = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}
export function channelContrastStyle(
  context: ChannelContrastContextValue | null,
  channel: { x: number; y: number; maxWidth: number; fontSize: number; color: string; backgroundColor?: string | null },
): CSSProperties {
  if (!context || channel.backgroundColor) return {};
  const scale = context.scale ?? 1;
  const x = channel.x + (context.offset?.x ?? 0);
  const y = channel.y + (context.offset?.y ?? 0);
  const w = channel.maxWidth * scale;
  const h = channel.fontSize * 1.5 * scale;
  const v = context.video;
  if (Math.min(x + w / 2, v.x + v.width, 1080) <= Math.max(x - w / 2, v.x, 0)
    || Math.min(y + h / 2, v.y + v.height, 1920) <= Math.max(y - h / 2, v.y, 0)) return {};
  // CSS stroke is centered on the glyph edge; Pillow's width is outward.
  return { WebkitTextStroke: `${6 / 10.8}cqw ${channelContrastColor(channel.color)}`, paintOrder: "stroke fill" };
}

// Candidate IDs remain unreachable until their immutable renderer verification and rollout.
// Older owned projects retain the preview matching their pinned renderer.
const channelContrastReleaseIds = new Set([
  "0da9c98f-ac82-4768-b26f-e5be1cee6989",
  "34df634e-d49a-4171-b3ea-f86199543ec1",
  "6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91",
  "ec4790a8-1c5c-41c8-ab95-c1e1db19055c",
  "f8f16bdc-a6ec-4de2-b4ed-08947d4b2994"
]);
export function editorHasChannelContrast(releaseId: string | null): boolean {
  return releaseId !== null && channelContrastReleaseIds.has(releaseId);
}
