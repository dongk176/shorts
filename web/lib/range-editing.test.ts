import { describe, expect, it } from "vitest";
import {
  adjustTimedRange,
  clampTimelineSeconds,
  roundTimelineHandleSeconds,
  scaleTimedRanges,
  subtitlesForTimelineSelection,
} from "./range-editing";

describe("range editing helpers", () => {
  it("rebases timeline subtitles to the selected clip", () => {
    expect(subtitlesForTimelineSelection([
      { start: 5, end: 10, text: "앞 문장" },
      { start: 20, end: 25, text: "선택 문장" },
    ], 90, 108, 120)).toEqual([
      { start: 2, end: 7, text: "선택 문장" },
    ]);
  });

  it("retimes comments proportionally without changing their content", () => {
    expect(scaleTimedRanges([
      { startSeconds: 0, endSeconds: 10, text: "첫 댓글" },
      { startSeconds: 10, endSeconds: 20, text: "둘째 댓글" },
    ], 20, 30)).toEqual([
      { startSeconds: 0, endSeconds: 15, text: "첫 댓글" },
      { startSeconds: 15, endSeconds: 30, text: "둘째 댓글" },
    ]);
  });

  it("moves a comment range without crossing adjacent comments", () => {
    expect(adjustTimedRange(
      { startSeconds: 5, endSeconds: 10 },
      "move",
      8,
      20,
      3,
      14,
    )).toEqual({ startSeconds: 9, endSeconds: 14 });
  });

  it("resizes either edge while preserving a minimum comment duration", () => {
    expect(adjustTimedRange(
      { startSeconds: 5, endSeconds: 10 },
      "start",
      8,
      20,
      0,
      20,
    )).toEqual({ startSeconds: 9.7, endSeconds: 10 });
    expect(adjustTimedRange(
      { startSeconds: 5, endSeconds: 10 },
      "end",
      -8,
      20,
      0,
      20,
    )).toEqual({ startSeconds: 5, endSeconds: 5.3 });
  });

  it("keeps rounded range handles inside fractional timeline boundaries", () => {
    expect(roundTimelineHandleSeconds(870.03, 870.03, 990)).toBe(870.03);
    expect(roundTimelineHandleSeconds(989.97, 870.03, 989.97)).toBe(989.97);
    expect(clampTimelineSeconds(990.03, 870.03, 990)).toBe(990);
  });
});
