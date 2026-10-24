export type RankingPlaybackClip = {
  transitionUrl?: string;
  rank: number;
  sourceId: string;
  start: number;
  end: number;
};

export function rankingPlaybackPosition(
  clips: RankingPlaybackClip[],
  seconds: number,
) {
  let offset = 0;
  const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const length = clip.end - clip.start;
    if (target < offset + length || index === clips.length - 1) {
      return {
        index,
        time: clip.start + Math.min(length, target - offset),
        offset,
      };
    }
    offset += length;
  }
  return null;
}
