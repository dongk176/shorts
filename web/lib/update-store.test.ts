import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), translate: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./update-translation-server", () => ({ translateUpdate: mocks.translate }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("./recent-updates", () => ({ RECENT_UPDATES_TAG: "recent" }));
import { saveUpdate } from "./update-store";
import { updateDraftSchema } from "./update-content";
import { readFileSync } from "node:fs";
const post = updateDraftSchema.parse(JSON.parse(readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8").split("$seed$")[1])[0]);
const input = { id: "11111111-1111-4111-8111-111111111111", version: 1, action: "publish" as const, draft: post };
beforeEach(() => vi.resetAllMocks());
describe("atomic multilingual publication", () => {
 it("does not touch the database or published snapshot after translation fails", async () => {
  mocks.translate.mockRejectedValue(new Error("Translation unavailable"));
  await expect(saveUpdate(input, input.id)).rejects.toThrow("Translation unavailable");
  expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
 });
 it("rechecks the editor version after translation and prevents stale overwrites", async () => {
  mocks.translate.mockResolvedValue(post);
  const tx = vi.fn().mockResolvedValue([{ version: 2, draft: post }]);
  mocks.getDb.mockReturnValue({ begin: async (callback: (tx: unknown) => Promise<void>) => callback(tx) });
  await expect(saveUpdate(input, input.id)).rejects.toMatchObject({ status: 409 });
  expect(tx).toHaveBeenCalledOnce(); expect(mocks.revalidate).not.toHaveBeenCalled();
 });
 it("saves a prepared translation as a draft without publishing or changing visibility", async () => {
  const translated = { ...post, translations: { en: {}, ja: {} } }; mocks.translate.mockResolvedValue(translated);
  const tx = Object.assign(vi.fn().mockResolvedValueOnce([{ version: 1, draft: post }]).mockResolvedValue([]), { json: (value: unknown) => value });
  const sql = Object.assign(vi.fn().mockResolvedValue([]), { begin: async (callback: (tx: unknown) => Promise<void>) => callback(tx) }); mocks.getDb.mockReturnValue(sql);
  await saveUpdate({ ...input, action: "translate" }, input.id);
  const mutation = (tx.mock.calls.at(-1)![0] as unknown as string[]).join("?");
  expect(mutation).toContain("set slug="); expect(mutation).toContain("draft="); expect(mutation).not.toContain("published="); expect(mutation).not.toContain("visible=");
  expect(tx.mock.calls.at(-1)).toContain(translated); expect(mocks.revalidate).not.toHaveBeenCalled();
 });
});
