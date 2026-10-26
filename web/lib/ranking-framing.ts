import { z } from "zod";
import { rankingDesign } from "./ranking-templates";

export const rankingFramingSchema = z.object({
  top: z.number().finite().min(0).max(.6),
  bottom: z.number().finite().min(0).max(.6),
  zoom: z.number().finite().min(1).max(2.5),
  panY: z.number().finite().min(-1).max(1),
}).strict().refine(value => value.top + value.bottom <= .8);
export type RankingFraming = z.infer<typeof rankingFramingSchema>;
export const defaultRankingFraming: RankingFraming = { top: 0, bottom: 0, zoom: 1, panY: 0 };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
export function normalizeRankingFraming(value?: Partial<RankingFraming>): RankingFraming {
  const top = clamp(value?.top ?? 0, 0, .6);
  return { top, bottom: clamp(value?.bottom ?? 0, 0, Math.min(.6, .8 - top)), zoom: clamp(value?.zoom ?? 1, 1, 2.5), panY: clamp(value?.panY ?? 0, -1, 1) };
}

// Cuts mask the original media without changing scale or position. Only the
// explicit zoom/pan controls change framing; removed pixels remain black.
export function rankingFramingGeometry(width: number, height: number, value?: Partial<RankingFraming>) {
  const framing = normalizeRankingFraming(value);
  const aspect = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 9 / 16;
  const target = rankingDesign.layout.width / (rankingDesign.layout.height - rankingDesign.layout.headerHeight);
  const scaleX = Math.max(1, aspect / target) * framing.zoom;
  const scaleY = Math.max(1, target / aspect) * framing.zoom;
  const visibleHeight = 1 / scaleY;
  const travel = 1 - visibleHeight;
  return {
    window: { width: `${scaleX * 100}%`, height: `${scaleY * 100}%`, left: "50%", top: `${50 + (scaleY - 1) * framing.panY * 50}%`, transform: "translate(-50%, -50%)" },
    media: { top: "0%", height: "100%", clipPath: `inset(${framing.top * 100}% 0 ${framing.bottom * 100}% 0)` },
    viewport: { left: (1 - 1 / scaleX) / 2, top: travel * (1 - framing.panY) / 2, width: 1 / scaleX, height: visibleHeight },
    travel,
  };
}
