import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const url = process.env.UPDATE_CMS_TEST_DATABASE_URL;
describe.skipIf(!url)("isolated PostgreSQL multilingual update lifecycle", () => {
 let sql: ReturnType<typeof postgres>;
 let saveUpdate: typeof import("./update-store").saveUpdate;
 let publishedUpdates: typeof import("./update-store").publishedUpdates;
 let post: import("./update-content").UpdateContent;
 const id = "11111111-1111-4111-8111-111111111111";
 beforeAll(async () => {
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith("/update_cms_test")) throw Error("Isolated local DB required");
  process.env.DATABASE_URL = url;
  sql = postgres(url, { transform: postgres.camel });
  await sql`create schema shorts_mvp`;
  await sql`create table shorts_mvp.update_posts (id uuid primary key, slug text unique not null, draft jsonb not null, published jsonb, published_assets uuid[] not null default '{}', visible boolean not null default false, first_published_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid, version integer not null default 0, sort_order integer not null default 0)`;
  await sql`create table shorts_mvp.update_assets (id uuid primary key)`;
  ({ saveUpdate, publishedUpdates } = await import("./update-store"));
  const { updateDraftSchema } = await import("./update-content");
  const { updateSourceTexts } = await import("./update-localization");
  post = updateDraftSchema.parse(JSON.parse(readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8").split("$seed$")[1])[0]);
  const dict = Object.fromEntries(updateSourceTexts(post).map((s, i) => [s, `Translated ${i}`]));
  post.translations = { en: dict, ja: dict };
 });
 afterAll(async () => { if (sql) { await sql.end(); const { getDb } = await import("./db"); await getDb().end(); } });
 it("atomically publishes all languages, renders stored translations, and preserves the live snapshot on draft edits", async () => {
  const published = await saveUpdate({ id, version: 0, action: "publish", draft: post }, id);
  expect(published.visible).toBe(true); expect(published.version).toBe(1); expect(published.hasChanges).toBe(false);
  expect((await publishedUpdates("en"))[0].title).toBe("Translated 0");
  expect((await publishedUpdates("ja"))[0].title).toBe("Translated 0");
  const draft = await saveUpdate({ id, version: 1, action: "save", draft: { ...post, title: "수정 중" } }, id);
  expect(draft.hasChanges).toBe(true);
  const [row] = await sql`select draft, published from shorts_mvp.update_posts where id=${id}`;
  expect(row.published.title).toBe(post.title); expect(row.draft.title).toBe("수정 중");
 });
 it("leaves the live snapshot and version intact when translation is unavailable", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  await expect(saveUpdate({ id, version: 2, action: "publish", draft: { ...post, title: "새로운 원문" } }, id)).rejects.toMatchObject({ status: 503 });
  vi.unstubAllEnvs();
  const [row] = await sql`select version, published from shorts_mvp.update_posts where id=${id}`;
  expect(row.version).toBe(2); expect(row.published.title).toBe(post.title);
 });
 it("rejects outdated editor versions without overwriting a newer draft", async () => {
  await expect(saveUpdate({ id, version: 1, action: "publish", draft: post }, id)).rejects.toMatchObject({ status: 409 });
  expect((await sql`select draft from shorts_mvp.update_posts where id=${id}`)[0].draft.title).toBe("수정 중");
 });
 it("hides every language together without requiring translation", async () => {
  await saveUpdate({ id, version: 2, action: "hide", draft: { ...post, title: "수정 중" } }, id);
  expect(await publishedUpdates("ko")).toEqual([]); expect(await publishedUpdates("en")).toEqual([]); expect(await publishedUpdates("ja")).toEqual([]);
 });
});
