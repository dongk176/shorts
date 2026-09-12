import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasUnlabeledAmount } from "./language-context";
import { parseCommentRegenerationResponse } from "./comment-regeneration";

const cases = JSON.parse(readFileSync("../worker/tests/fixtures/currency-label-cases.json", "utf8")) as Array<{
  text: string; missing: boolean; source?: string;
}>;

describe("source currency labels", () => {
  it.each(cases)("$text", ({ text, source, missing }) => {
    expect(hasUnlabeledAmount(text, source ?? "15만 원과 53만 달러입니다.")).toBe(missing);
  });
  it("rejects unlabeled regeneration amounts while preserving old requests", () => {
    const payload = { choices: [{ message: { content: JSON.stringify({ comments: ["月7億稼げるなんてすごい"] }) } }] };
    expect(parseCommentRegenerationResponse(payload, 1, "ja")).toHaveLength(1);
    const rejections = {};
    expect(() => parseCommentRegenerationResponse(payload, 1, "ja", rejections, "1,200만 원입니다.")).toThrow("wrong_comment_count");
    expect(rejections).toEqual({ currency: 1 });
  });
});
