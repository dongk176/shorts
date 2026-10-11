import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { PGlite, type Transaction } from "../../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/usage", () => ({ getUsageSnapshot: async () => ({ remainingSeconds: 1800 }) }));
import { GET, POST } from "./route";
import { HttpError } from "@/lib/http";
let pg: PGlite;
let userId: string;
function adapter(connection: PGlite | Transaction) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    const result = await connection.query(query, values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>)
      .map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])));
  };
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp; create role anon; create role authenticated; create role service_role;
    create table shorts_mvp.app_users(id uuid primary key);
    create table shorts_mvp.video_jobs(user_id uuid, is_example boolean, status text, completed_at timestamptz);
    create table shorts_mvp.usage_grants(id uuid primary key default gen_random_uuid(), user_id uuid,
      kind text, product_code text,total_seconds integer,credited_seconds integer,carried_seconds integer,
      reserved_seconds integer,consumed_seconds integer,valid_from timestamptz,expires_at timestamptz,status text);`);
  await pg.exec(readFileSync("../supabase/migrations/202607260005_project_feedback.sql", "utf8"));
  await pg.exec(readFileSync("../supabase/migrations/20261011100636_project_feedback_rating_only.sql", "utf8"));
  const sql = Object.assign(adapter(pg), { begin: (fn: (tx: Sql) => Promise<unknown>) =>
    pg.transaction(tx => fn(adapter(tx) as unknown as Sql)) });
  mocks.db.mockReturnValue(sql);
}, 30000);
beforeEach(async () => {
  await pg.exec("truncate shorts_mvp.project_feedback_responses,shorts_mvp.project_feedback_prompt_deferrals,shorts_mvp.usage_grants,shorts_mvp.video_jobs,shorts_mvp.app_users cascade");
  userId = randomUUID();
  await pg.query("insert into shorts_mvp.app_users values ($1)", [userId]);
  await pg.query("insert into shorts_mvp.video_jobs values ($1,false,'completed',now())", [userId]);
  mocks.session.mockResolvedValue({ userId });
});
afterAll(async () => { await pg?.close(); });
const request = (payload: Record<string, unknown>) => new Request("https://example.test/api/project-feedback", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
});
it.each([4, 5])("saves a rating-only %s response and issues exactly one reward through the real route", async satisfactionRating => {
  expect(await (await GET()).json()).toMatchObject({ eligible: true, submitted: false });
  const payload = { requestId: randomUUID(), satisfactionRating };
  const response = await POST(request(payload));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ submitted: true, rewardSeconds: 1800 });
  expect((await pg.query("select satisfaction_rating,disappointment_reason,improvement_text from shorts_mvp.project_feedback_responses")).rows)
    .toEqual([{ satisfaction_rating: satisfactionRating, disappointment_reason: null, improvement_text: null }]);
  expect((await POST(request(payload))).status).toBe(200);
  expect((await POST(request({ ...payload, requestId: randomUUID() }))).status).toBe(409);
  expect((await pg.query("select count(*)::int as count,sum(total_seconds)::int as seconds from shorts_mvp.usage_grants")).rows[0])
    .toEqual({ count: 1, seconds: 1800 });
  expect(await (await GET()).json()).toMatchObject({ eligible: false, submitted: true });
});
it("rejects missing low-rating details without granting a reward, then saves the selected reason", async () => {
  const payload = { requestId: randomUUID(), satisfactionRating: 3 };
  expect((await POST(request(payload))).status).toBe(400);
  expect((await pg.query("select count(*)::int as count from shorts_mvp.usage_grants")).rows[0]).toEqual({ count: 0 });
  expect((await POST(request({ ...payload, disappointmentReason: "result_quality", improvementText: "test feedback" }))).status).toBe(200);
  expect((await pg.query("select disappointment_reason,improvement_text from shorts_mvp.project_feedback_responses")).rows[0])
    .toEqual({ disappointment_reason: "result_quality", improvement_text: "test feedback" });
});
it("rejects guests and accounts without a completed project", async () => {
  mocks.session.mockRejectedValueOnce(new HttpError(401, "로그인이 필요합니다."));
  expect((await GET()).status).toBe(401);
  await pg.exec("truncate shorts_mvp.video_jobs");
  expect((await POST(request({ requestId: randomUUID(), satisfactionRating: 5 }))).status).toBe(409);
  expect((await pg.query("select count(*)::int as count from shorts_mvp.usage_grants")).rows[0]).toEqual({ count: 0 });
});
