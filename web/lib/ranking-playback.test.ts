import { describe, expect, it } from "vitest";
import { rankingPlaybackPosition } from "./ranking-playback";

const clips = [
  { rank: 8, sourceId: "a", start: 20, end: 22 },
  { rank: 3, sourceId: "b", start: 4, end: 7 },
  { rank: 1, sourceId: "c", start: 0.5, end: 1.5 },
];
describe("ranking whole-preview seeking", () => {
  it("maps the full timeline onto selected source intervals without empty ranks", () => {
    expect(rankingPlaybackPosition(clips, 0)).toEqual({
      index: 0,
      time: 20,
      offset: 0,
    });
    expect(rankingPlaybackPosition(clips, 2)).toEqual({
      index: 1,
      time: 4,
      offset: 2,
    });
    expect(rankingPlaybackPosition(clips, 4.5)).toEqual({
      index: 1,
      time: 6.5,
      offset: 2,
    });
    expect(rankingPlaybackPosition(clips, 5)).toEqual({
      index: 2,
      time: 0.5,
      offset: 5,
    });
    expect(rankingPlaybackPosition(clips, 100)).toEqual({
      index: 2,
      time: 1.5,
      offset: 5,
    });
  });
  it("handles no clips, negative times and the reverse playback order", () => {
    expect(rankingPlaybackPosition([], 0)).toBeNull();
    expect(rankingPlaybackPosition(clips, -1)?.time).toBe(20);
    expect(rankingPlaybackPosition([...clips].reverse(), 1)).toEqual({
      index: 1,
      time: 4,
      offset: 1,
    });
  });
});
