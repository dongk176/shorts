import { describe, expect, it } from "vitest";
import { scaleTimedRanges, subtitlesForTimelineSelection } from "./range-editing";

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
});
