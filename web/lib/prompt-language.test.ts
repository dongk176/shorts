import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCommentRegenerationMessages } from "./comment-regeneration";
import translations from "./prompt-translations.json";

const input = {
  title: "원본 제목", highlightReason: "",
  transcript: [{ start: 0, end: 54, text: "원본 내용 {transcript}를 번역하지 않는다." }],
  targetCount: 8,
};

describe("instruction language only", () => {
  it("preserves the exact original Korean prompt", () => {
    expect(createHash("sha256").update(JSON.stringify(
      buildCommentRegenerationMessages(input),
    )).digest("hex")).toBe("c3f95e29d85d00d639faf3fe4d5ed21c1fbf9fc0c66f9a3d75b0ea8d43e762d3");
  });

  it("keeps worker and web translations identical", () => {
    const worker = JSON.parse(readFileSync(new URL(
      "../../worker/shorts_worker/prompt_translations.json", import.meta.url,
    ), "utf8"));
    expect(translations).toEqual(worker);
    expect(JSON.stringify(translations)).not.toMatch(/example|demonstration|例えば|例文|예시|모범/i);
  });

  it.each(["en", "ja"] as const)("changes only instruction language for %s", (outputLanguage) => {
    const original = buildCommentRegenerationMessages(input);
    const messages = buildCommentRegenerationMessages({ ...input, outputLanguage });
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0].content).not.toMatch(/[가-힣]/);
    expect(messages[0].content.match(/\d+(?:\.\d+)?/g)).toEqual(
      original[0].content.match(/\d+(?:\.\d+)?/g),
    );
    expect(messages[0].content).toContain(`outputLanguage=${outputLanguage}`);
    expect(messages[1].content).toContain(input.title);
    expect(messages[1].content).toContain(input.transcript[0].text);
    expect(messages[1].content).toContain("targetCommentCount: 8");
  });

  it.each(["en", "ja"] as const)("retains source truncation and localized absence markers for %s", (outputLanguage) => {
    const text = "가".repeat(13000);
    const messages = buildCommentRegenerationMessages({ ...input, outputLanguage,
      transcript: [{ start: 0, end: 1, text }],
    });
    expect(messages[1].content.endsWith("가".repeat(12000))).toBe(true);
    expect(messages[1].content).not.toContain("가".repeat(12001));
    const empty = buildCommentRegenerationMessages({ ...input, outputLanguage, transcript: [] });
    expect(empty[1].content).toContain(translations[outputLanguage].no_transcript);
    expect(empty[1].content).toContain(translations[outputLanguage].no_reason);
  });
});
