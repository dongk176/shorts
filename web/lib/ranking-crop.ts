import { rankingDesign } from "./ranking-templates";

// Same scale-to-cover and centered crop used by ranking_pipeline.py.
export function rankingCropSize(width: number, height: number) {
  const aspect = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 9 / 16;
  const target = rankingDesign.layout.width / (rankingDesign.layout.height - rankingDesign.layout.headerHeight);
  return {
    width: `${Math.max(1, aspect / target) * 100}%`,
    height: `${Math.max(1, target / aspect) * 100}%`,
  };
}
