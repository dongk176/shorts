import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp; create role anon; create role authenticated; create role service_role;
    create table shorts_mvp.app_users(id uuid primary key);
    create table shorts_mvp.usage_grants(id uuid primary key, user_id uuid, product_code text);`);
  await pg.exec(readFileSync("../supabase/migrations/202607260005_project_feedback.sql", "utf8"));
  await pg.exec(readFileSync("../supabase/migrations/20261011100636_project_feedback_rating_only.sql", "utf8"));
}, 30000);
afterAll(async () => { await pg?.close(); });
async function insert(rating: number, reason: string | null) {
  return pg.query(`with u as (insert into shorts_mvp.app_users values(gen_random_uuid()) returning id),
    g as (insert into shorts_mvp.usage_grants select gen_random_uuid(),id,'feedback_reward_30m' from u returning *)
    insert into shorts_mvp.project_feedback_responses(user_id,request_id,satisfaction_rating,disappointment_reason,
      prompt_completion_count,completed_project_count,reward_grant_id)
    select user_id,gen_random_uuid(),$1,$2,1,1,id from g returning satisfaction_rating,disappointment_reason`, [rating, reason]);
}
it.each([4, 5])("persists rating %s without invented reasons", async rating => {
  expect((await insert(rating, null)).rows[0]).toEqual({ satisfaction_rating: rating, disappointment_reason: null });
});
it.each([1, 2, 3])("enforces a reason for rating %s in PostgreSQL", async rating => {
  await expect(insert(rating, null)).rejects.toThrow();
  expect((await insert(rating, "result_quality")).rows).toHaveLength(1);
});
it("rejects invalid reasons and preserves client access restrictions", async () => {
  await expect(insert(4, "invalid")).rejects.toThrow();
  const result = await pg.query(`select relrowsecurity as rls,
    has_table_privilege('anon','shorts_mvp.project_feedback_responses','INSERT') as anon_insert,
    has_table_privilege('authenticated','shorts_mvp.project_feedback_responses','INSERT') as authenticated_insert
    from pg_class where oid='shorts_mvp.project_feedback_responses'::regclass`);
  expect(result.rows[0]).toEqual({ rls: true, anon_insert: false, authenticated_insert: false });
});
