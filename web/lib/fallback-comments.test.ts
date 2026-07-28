import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_COMMENT_TEXTS,
  selectRandomFallbackCommentTexts,
} from "./fallback-comments";

describe("fallback comments", () => {
  it("stays in sync with the worker fallback catalog", () => {
    const workerComments = readFileSync(
      path.resolve(process.cwd(), "../worker/shorts_worker/fallback_comments.txt"),
      "utf8",
    )
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    expect(FALLBACK_COMMENT_TEXTS).toEqual(workerComments);
    expect(FALLBACK_COMMENT_TEXTS).toHaveLength(425);
    expect(new Set(FALLBACK_COMMENT_TEXTS).size).toBe(425);
  });

  it("selects distinct comments and honors existing comment exclusions", () => {
    const excluded = FALLBACK_COMMENT_TEXTS.slice(0, 2);
    const selected = selectRandomFallbackCommentTexts(3, excluded, () => 0);

    expect(selected).toEqual(FALLBACK_COMMENT_TEXTS.slice(2, 5));
    expect(new Set(selected).size).toBe(3);
  });
});
