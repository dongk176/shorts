export const COMMENT_LIKE_COUNT_MIN = 10;
export const COMMENT_LIKE_COUNT_MAX = 8_000;
export const COMMENT_CAPTURE_BODY_FONT_CQW = 3.83;

export function randomCommentLikeCount(random: () => number = Math.random) {
  return Math.floor(random() * (COMMENT_LIKE_COUNT_MAX - COMMENT_LIKE_COUNT_MIN + 1))
    + COMMENT_LIKE_COUNT_MIN;
}
