import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseCommentRegenerationResponse } from "./comment-regeneration";
import { generateCommentsWithGemini } from "./comment-regeneration-server";

const response = (comments: string[]) => ({ choices: [{ message: {
  content: JSON.stringify({ comments }),
} }] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  ["en", "Would the next one cost $2500?"],
  ["en", "Maybe 3 million next time?"],
  ["en", "I'd pay 150 euros for that!"],
  ["ja", "次は2500ドルになるのかな？"],
  ["ja", "次は300万になるのかな？"],
  ["ja", "150ユーロなら買いたいな"],
] as const)("preserves %s wording without a separate money validator", async (outputLanguage, comment) => {
  const source = "It costs 2000 dollars. 費用は2000ドルです。";
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(response([comment]))));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  const input = { title: "Price", highlightReason: "", targetCount: 1, outputLanguage,
    sourceLanguage: outputLanguage, transcript: [{ start: 0, end: 30, text: source }] };
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", GEMINI_API_KEY: "test",
    GEMINI_PAID_DATA_PROCESSING_CONFIRMED: "true" };
  await expect(generateCommentsWithGemini(input, env)).resolves.toEqual([comment]);
  await expect(generateCommentsWithGemini({ ...input, languageTest: true }, env))
    .resolves.toEqual([comment]);
  const bodies = fetchMock.mock.calls.map((call) => JSON.parse(
    (call as unknown as [URL, RequestInit])[1].body as string,
  ));
  expect(bodies[0]).toEqual(bodies[1]);
});

it("preserves Korean wording without extracting or comparing currency", () => {
  const payload = response(["150유로면 사고 싶다"]);
  expect(parseCommentRegenerationResponse(
    payload, 1, "ko", {}, "가격은 2000달러입니다.", false,
  )).toEqual(["150유로면 사고 싶다"]);
  expect(parseCommentRegenerationResponse(
    payload, 1, "ko", {}, "가격은 2000달러입니다.", true,
  )).toEqual(["150유로면 사고 싶다"]);
});

it.each(["한국어 댓글입니다", "Apple Watch Ultra", "x".repeat(100)])(
  "preserves names and supplied wording in language projects: %s", (comment) => {
    expect(parseCommentRegenerationResponse(response([comment]), 1, "en", {}, "source", true))
      .toEqual([comment]);
  },
);

it.each([
  { comments: [""] },
  { comments: ["A", "A"] },
  { comments: ["This is the same comment", "This is the same comment!"] },
  { comments: ["x".repeat(201)] },
])("retains storage, duplicate and count checks", ({ comments }) => {
  expect(() => parseCommentRegenerationResponse(
    response(comments), comments.length, "en", {}, "2000 dollars", true,
  )).toThrow("wrong_comment_count");
});
