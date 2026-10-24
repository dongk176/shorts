import manifest from "../../worker/shorts_worker/assets/ranking_audio.json";
import { z } from "zod";
import type { RankingPlaybackClip } from "./ranking-playback";

export const rankingSounds = manifest;
export const rankingSoundSchema = z.enum(["kick", "lip-bass", "whoosh", "scratch"]);
export type RankingSound = z.infer<typeof rankingSoundSchema>;
export const rankingMusicSchema = z.object({
  sourceId: z.uuid(), volume: z.number().finite().min(0).max(1),
}).strict();
export function transitionSeconds(sound: RankingSound | null | undefined, count: number) {
  return (rankingSounds.find((item) => item.id === sound)?.duration ?? 0) * Math.max(0, count - 1);
}
export function rankingAudioSequence(clips: RankingPlaybackClip[], sound?: RankingSound | null): RankingPlaybackClip[] {
  const selected = rankingSounds.find((item) => item.id === sound);
  if (!selected) return clips;
  return clips.flatMap((clip, index) => index === 0 ? [clip] : [
    {rank: clip.rank, sourceId: `transition-${index}`, start: 0, end: selected.duration,
      transitionUrl: `/audio/ranking/${selected.id}.mp4`}, clip,
  ]);
}
