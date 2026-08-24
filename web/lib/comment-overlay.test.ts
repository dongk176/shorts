import { describe, expect, it } from "vitest";
import {
  COMMENT_CAPTURE_BODY_FONT_CQW,
  COMMENT_LIKE_COUNT_MAX,
  COMMENT_LIKE_COUNT_MIN,
  randomCommentLikeCount,
} from "@/lib/comment-overlay";

describe("randomCommentLikeCount", () => {
  it("keeps the comment preview body two canvas pixels smaller", () => {
    expect(COMMENT_CAPTURE_BODY_FONT_CQW).toBe(3.83);
  });

  it("includes the requested lower and upper bounds", () => {
    expect(randomCommentLikeCount(() => 0)).toBe(COMMENT_LIKE_COUNT_MIN);
    expect(randomCommentLikeCount(() => 0.999999999)).toBe(COMMENT_LIKE_COUNT_MAX);
  });

  it("keeps generated values between 10 and 8000", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(randomCommentLikeCount()).toBeGreaterThanOrEqual(10);
      expect(randomCommentLikeCount()).toBeLessThanOrEqual(8_000);
    }
  });
});
