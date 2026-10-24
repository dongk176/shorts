import {describe, it, expect} from "vitest";
import {rankingAudioSequence, rankingSounds, transitionSeconds} from "./ranking-audio";
import {rankingPlaybackPosition} from "./ranking-playback";
import {rankingRenderSchema} from "./ranking-shorts";
const clips = [3, 1, 5].map((rank) => ({rank, sourceId: "193a3540-3366-4526-94be-030a34293344", label: "장면", start: 0, end: 1}));
describe("ranking optional audio", () => {
 it("inserts one selected sound only between populated ranks in their chosen order", () => {
  for (const sound of rankingSounds) {
   const sequence = rankingAudioSequence(clips, sound.id as "kick");
   expect(sequence.map((clip) => clip.rank)).toEqual([3,1,1,5,5]);
   expect(sequence.filter((clip) => clip.transitionUrl)).toHaveLength(2);
   expect(sequence[0].transitionUrl).toBeUndefined();
   expect(sequence.at(-1)?.transitionUrl).toBeUndefined();
   expect(rankingPlaybackPosition(sequence, 1.1)?.index).toBe(1);
   expect(rankingPlaybackPosition(sequence, 1 + sound.duration + 0.1)?.index).toBe(2);
   expect(transitionSeconds(sound.id as "kick", 3)).toBe(sound.duration * 2);
  }
  expect(rankingAudioSequence(clips, null)).toEqual(clips);
  expect(rankingAudioSequence([clips[0]], "kick")).toEqual([clips[0]]);
 });
 it("validates a single allowlisted sound and includes transitions in the 180 second limit", () => {
  const spec = {title: "제목", descending: true, rankCount: 5, clips: clips.map((clip) => ({...clip, end: 60}))};
  expect(rankingRenderSchema.safeParse(spec).success).toBe(true);
  expect(rankingRenderSchema.safeParse({...spec, transitionSound: "kick"}).success).toBe(false);
  for (const transitionSound of ["../secret", ["kick", "scratch"]])
   expect(rankingRenderSchema.safeParse({...spec, transitionSound}).success).toBe(false);
 });
 it("allows music independently and bounds volume and identifiers", () => {
  const spec = {title: "제목", descending: true, rankCount: 5, clips};
  expect(rankingRenderSchema.safeParse({...spec, backgroundMusic: {sourceId: clips[0].sourceId, volume: 0.15}}).success).toBe(true);
  for (const volume of [-1, 1.1, NaN])
   expect(rankingRenderSchema.safeParse({...spec, backgroundMusic: {sourceId: clips[0].sourceId, volume}}).success).toBe(false);
 });
});
