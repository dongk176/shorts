import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

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
  await db.exec(await readFile(new URL("../../supabase/migrations/20261104170150_public_shorts_silence.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await db?.close(); });
const insert = (owner = admin) => db.exec(`insert into shorts_mvp.admin_short_silence_tasks
  (short_id,job_id,user_id,request_id,lease_id,lease_until,state)
  values ('${short}','${job}','${owner}','${request}','${lease}',now()+interval '3 minutes','processing')`);

describe("private silence task storage", () => {
  it("blocks foreign ownership even with a valid private request", async () => {
    await expect(insert(user)).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
  });
  it("accepts ordinary owned tasks while requiring the exact opt-in request", async () => {
    await db.exec(`update shorts_mvp.app_users set is_admin=false where id='${admin}'`);
    await insert();
    await db.exec("delete from shorts_mvp.admin_short_silence_tasks");
    await db.exec(`update shorts_mvp.app_users set is_admin=true where id='${admin}'; update shorts_mvp.video_jobs set template_snapshot='{}'`);
    await expect(insert()).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
    await db.exec(`update shorts_mvp.video_jobs set template_snapshot='{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}'`);
  });
  it("persists one owned task and prevents identity replacement and duplicates", async () => {
    await insert();
    await expect(insert()).rejects.toThrow();
    await expect(db.exec(`update shorts_mvp.admin_short_silence_tasks set user_id='${user}'`)).rejects.toThrow("SILENCE_TASK_IDENTITY_IMMUTABLE");
    expect((await db.query("select count(*)::int as n from shorts_mvp.admin_short_silence_tasks")).rows).toEqual([{ n: 1 }]);
  });
  it.each(["anon", "authenticated"])("denies %s direct reads and writes", async role => {
    for (const query of ["select * from shorts_mvp.admin_short_silence_tasks", "delete from shorts_mvp.admin_short_silence_tasks", "update shorts_mvp.admin_short_silence_tasks set state='completed'"]) {
      await db.exec(`set role ${role}`);
      await expect(db.exec(query)).rejects.toThrow();
      await db.exec("reset role");
    }
  });
  it("does not install triggers on ordinary job or generated-short tables", async () => {
    expect((await db.query("select count(*)::int as n from pg_trigger where not tgisinternal and tgrelid in ('shorts_mvp.video_jobs'::regclass,'shorts_mvp.generated_shorts'::regclass)")).rows).toEqual([{ n: 0 }]);
  });
});
