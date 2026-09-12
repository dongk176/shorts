import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ungroundedMoney } from "./money-facts";
import { parseCommentRegenerationResponse, type CommentRejectionCounts } from "./comment-regeneration";

const cases = JSON.parse(readFileSync("../worker/tests/fixtures/money-facts.json", "utf8")) as Array<{
  source: string; text: string; reject: boolean;
}>;

describe("monetary source grounding", () => {
  it.each(cases)("$text", ({ source, text, reject }) => {
    expect(ungroundedMoney(text, source)).toBe(reject);
  });

  it("rejects the observed false minimum before regeneration succeeds", () => {
    const counts: CommentRejectionCounts = {};
    expect(() => parseCommentRegenerationResponse({ choices: [{ message: { content: JSON.stringify({
      comments: ["Elderly need 2M KRW min? Sad."],
    }) } }] }, 1, "en", counts, "노인이 돼도 100에서200만원이 필요하대요")).toThrow("wrong_comment_count");
    expect(counts).toEqual({ money_not_grounded: 1 });
  });
});
