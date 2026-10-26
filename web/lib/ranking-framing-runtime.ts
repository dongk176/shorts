import { HttpError } from "./http";
import type { RankingRender } from "./ranking-shorts";

export const RANKING_FRAMING_CAPABILITY = "source-framing-v1";
export function rankingNeedsFraming(spec?: Pick<RankingRender, "clips">) {
  return Boolean(spec?.clips.some(({framing}) => framing &&
    (framing.top !== 0 || framing.bottom !== 0 || framing.zoom !== 1 || framing.panY !== 0)));
}
export function requireRankingFramingCapability(health: unknown) {
  const value = health as { ok?: unknown; capabilities?: unknown } | null;
  if (value?.ok !== true || !Array.isArray(value.capabilities) || !value.capabilities.includes(RANKING_FRAMING_CAPABILITY))
    throw new HttpError(409, "이전 편집 공간은 화면 조정을 지원하지 않습니다. 새 작업에서 영상을 추가해 주세요. 현재 입력 내용은 그대로 유지됩니다.");
}
