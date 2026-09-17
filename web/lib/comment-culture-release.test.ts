import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildCommentRegenerationMessages } from "./comment-regeneration";
import { generateCommentsWithGemini } from "./comment-regeneration-server";
import { CULTURE_COMMENT_PROFILE, CULTURE_COMMENT_MODEL } from "./comment-profile";
import prompts from "./comment-culture-prompts.json";

const input = { title: "원본 제목", highlightReason: "", targetCount: 1, sourceLanguage: "ko",
  transcript: [{ start: 0, end: 20, text: "원본 전사 {source}" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("release-pinned culture comments", () => {
  it("keeps the tested worker and editor instructions identical and affirmative", () => {
    expect(prompts).toEqual(JSON.parse(readFileSync(new URL(
      "../../worker/shorts_worker/comment_culture_prompts.json", import.meta.url,
    ), "utf8")));
    expect(JSON.stringify(prompts)).not.toMatch(/don't|do not|must not|never|avoid|example|demonstration|例えば|例文|예시|모범|しない|せず|禁止/i);
  });
  it("uses the ordinary Korean community voice for language-project regeneration", () => {
    const messages = buildCommentRegenerationMessages({ ...input, outputLanguage: "ko" });
    expect(messages[0].content).toContain("한국 유튜브와 숏폼 커뮤니티");
    expect(messages[0].content).toContain("개웃기네, 미쳤네");
    expect(messages[0].content).not.toContain("원본 영상의 언어");
    expect(messages[0].content).not.toContain("outputLanguage=");
    expect(messages[1].content).toContain(input.transcript[0].text);
  });
  it.each(["ko", "en", "ja"] as const)("preserves existing %s requests and only opts in the new release", async (outputLanguage) => {
    const comment = { ko: "이 장면이 기억에 남아요", en: "That timing was perfect!", ja: "この間の取り方が絶妙すぎる" }[outputLanguage];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ comments: [comment] }),
    } }] })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", GEMINI_API_KEY: "test", GEMINI_PAID_DATA_PROCESSING_CONFIRMED: "true", GEMINI_COMMENT_MODEL: "ordinary-model" };
    for (const commentProfile of [undefined, CULTURE_COMMENT_PROFILE] as const) {
      await expect(generateCommentsWithGemini({ ...input, outputLanguage, commentProfile }, env))
        .resolves.toEqual([comment]);
      const body = JSON.parse((fetchMock.mock.lastCall as unknown as [URL, RequestInit])[1].body as string);
      const optedIn = commentProfile !== undefined && outputLanguage !== "ko";
      expect(body.model).toBe(optedIn ? CULTURE_COMMENT_MODEL : "ordinary-model");
      const legacy = buildCommentRegenerationMessages({ ...input, outputLanguage });
      if (optedIn) {
        expect(body.messages).not.toEqual(legacy);
        expect(body.messages[0].content).not.toMatch(/[가-힣]/);
      } else expect(body.messages).toEqual(legacy);
      expect(body.messages[1].content).toContain(input.transcript[0].text);
    }
  });
});
