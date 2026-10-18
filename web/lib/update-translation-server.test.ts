import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { translateUpdate } from "./update-translation-server";
import { updateDraftSchema } from "./update-content";
import { localizeUpdate, updateSourceTexts } from "./update-localization";
import { readFileSync } from "node:fs";
const seed = JSON.parse(readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8").split("$seed$")[1]);
const post = updateDraftSchema.parse(seed[0]);
const env = { GEMINI_API_KEY: "test-key", GEMINI_PAID_DATA_PROCESSING_CONFIRMED: "true" };
afterEach(() => vi.unstubAllGlobals());
describe("bounded update translation before publication", () => {
 it("reuses complete reviewed translations without a provider or credentials", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const dictionary = Object.fromEntries(updateSourceTexts(post).map(s => [s, "Reviewed text"]));
  const result = await translateUpdate({ ...post, translations: { en: dictionary, ja: dictionary } }, {});
  expect(localizeUpdate(result, "en")?.title).toBe("Reviewed text"); expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([{}, { GEMINI_API_KEY: "test" }])("fails deterministically without configured paid processing", async config => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(translateUpdate(post, config)).rejects.toMatchObject({ status: 503 }); expect(fetcher).not.toHaveBeenCalled();
 });
 it("generates both languages but cannot change source fields or reviewed strings", async () => {
  const fetcher = vi.fn(async (_url, request) => {
   const body = JSON.parse(request.body);
   const input = JSON.parse(body.messages[1].content);
   expect(request.signal).toBeInstanceOf(AbortSignal);
   return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ items: input.map((p: { id: number }) => ({ id: p.id, en: `English ${p.id}`, ja: `日本語 ${p.id}` })) }) } }] });
  }); vi.stubGlobal("fetch", fetcher);
  const result = await translateUpdate({ ...post, translations: { en: { [post.title]: "Reviewed title" }, ja: {} } }, env);
  expect(result.title).toBe(post.title); expect(result.href).toBe(post.href);
  expect(localizeUpdate(result, "en")?.title).toBe("Reviewed title");
  expect(localizeUpdate(result, "ja")).not.toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(["truncated", "wrong-ids", "korean", "network"])("rejects %s responses without changing the source", async mode => {
  const original = JSON.stringify(post);
  vi.stubGlobal("fetch", vi.fn(async () => {
   if (mode === "network") throw new Error("provider secret detail");
   return Response.json({ choices: [{ finish_reason: mode === "truncated" ? "length" : "stop", message: { content: JSON.stringify({ items: updateSourceTexts(post).map((_, id) => ({ id: mode === "wrong-ids" ? 0 : id, en: mode === "korean" ? "한국어" : "English", ja: "日本語" })) }) } }] });
  }));
  await expect(translateUpdate(post, env)).rejects.toMatchObject({ status: 503 }); expect(JSON.stringify(post)).toBe(original);
 });
});
