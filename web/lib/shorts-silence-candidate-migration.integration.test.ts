import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { beforeAll, afterAll, expect, it } from "vitest";

let db: PGlite;
const admin = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333", short = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555", lease = "66666666-6666-4666-8666-666666666666";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema shorts_mvp;
    create table shorts_mvp.app_users(id uuid primary key,is_admin boolean not null);
    create table shorts_mvp.runtime_feature_flags(flag_key text primary key,enabled boolean not null,description text);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,is_example boolean,midform_request jsonb,template_snapshot jsonb);
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid);
    insert into shorts_mvp.app_users values ('${admin}',true),('${user}',false);
    insert into shorts_mvp.video_jobs values ('${job}','${admin}',false,null,'{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}');
    insert into shorts_mvp.generated_shorts values ('${short}','${job}','${admin}');`);
  await db.exec(await readFile(new URL("../../supabase/migrations/20261104050801_admin_shorts_silence_tasks.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261104171115_public_shorts_silence.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await db?.close(); });
const insert = (owner = admin) => db.exec(`insert into shorts_mvp.admin_short_silence_tasks
  (short_id,job_id,user_id,request_id,lease_id,lease_until,state)
  values ('${short}','${job}','${owner}','${request}','${lease}',now()+interval '3 minutes','processing')`);

const candidate = "77777777-7777-4777-8777-777777777777";
it("reproduces rejection and preserves ownership, ordinary opt-in and expiry boundaries", async () => {
  await db.exec(`alter table shorts_mvp.video_jobs add column language_test_release_id uuid; alter table shorts_mvp.video_jobs add column created_at timestamptz default now();
    create table shorts_mvp.silence_test_releases(id uuid primary key, administrator_id uuid, verified_at timestamptz, expires_at timestamptz);
    insert into shorts_mvp.silence_test_releases values ('${candidate}','${admin}',now()-interval '1 minute',now()+interval '1 hour');
    update shorts_mvp.video_jobs set language_test_release_id='${request}', template_snapshot='{"shortsSilenceCandidateId":"${candidate}","shortsSilenceRemovalCandidate":{"version":1,"preset":"aggressive"}}';`);
  await expect(insert()).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
  await db.exec(await readFile(new URL("../../supabase/migrations/20261105134650_candidate_language_silence_tasks.sql", import.meta.url), "utf8"));
  for (const change of [
    "update shorts_mvp.app_users set is_admin=false",
    `update shorts_mvp.silence_test_releases set administrator_id='${user}'`,
    "update shorts_mvp.silence_test_releases set verified_at=null",
    "update shorts_mvp.silence_test_releases set expires_at=now()-interval '1 minute'",
    "update shorts_mvp.video_jobs set language_test_release_id=null",
    "update shorts_mvp.video_jobs set is_example=true",
    "update shorts_mvp.video_jobs set midform_request='{}'"
  ]) {
    await db.exec("begin"); await db.exec(change);
    await expect(insert()).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
    await db.exec("rollback");
  }
  await expect(insert(user)).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
  await insert();
  await db.exec("update shorts_mvp.admin_short_silence_tasks set state='completed'");
  await expect(db.exec(`update shorts_mvp.admin_short_silence_tasks set user_id='${user}'`)).rejects.toThrow("SILENCE_TASK_IDENTITY_IMMUTABLE");
  await db.exec("delete from shorts_mvp.admin_short_silence_tasks");
  await db.exec(`update shorts_mvp.app_users set is_admin=false; update shorts_mvp.video_jobs set template_snapshot='{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}'`);
  await insert();
});
