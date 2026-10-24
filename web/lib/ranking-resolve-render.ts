import { RANKING_LIMITS, type RankingRender, type RankingSource } from "./ranking-shorts";

// Player metadata is only for editing. Resolve and validate every source on the
// server before submitting the render, preserving the user's order and ranges.
export async function resolveRankingRender(
  spec: RankingRender,
  resolve: (clip: RankingRender["clips"][number]) => Promise<RankingSource>,
): Promise<RankingRender> {
  const clips: RankingRender["clips"] = [];
  for (const clip of spec.clips) {
    const source = await resolve(clip);
    if (source.durationKnown === false || !Number.isFinite(source.duration) || source.duration <= 0)
      throw new Error(`${clip.rank}위 영상 길이를 확인하지 못했습니다. 영상을 다시 추가해 주세요.`);
    if (source.duration > RANKING_LIMITS.sourceSeconds)
      throw new Error(`${clip.rank}위 원본 영상은 20분 이하여야 합니다.`);
    if (clip.end > source.duration)
      throw new Error(`${clip.rank}위 선택 구간이 실제 영상 길이를 넘습니다. 끝 위치를 다시 선택해 주세요.`);
    clips.push({ ...clip, sourceId: source.id });
  }
  return { ...spec, clips };
}
