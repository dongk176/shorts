import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
const release = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema shorts_mvp;
    create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
    insert into shorts_mvp.app_users values ('${admin}',true),('${user}',false);
    create table shorts_mvp.editor_releases(id uuid primary key,git_sha text,worker_image_digest text,font_manifest_sha256 text,status text,staging_verified_at timestamptz);
    insert into shorts_mvp.editor_releases values ('${release}','sha','digest','font','canary_ready',now());
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,source_type text,planned_short_count int,initial_editor_release_id uuid,language_test_release_id uuid,is_example boolean default false,pipeline_version int,initial_render_spec_version int,initial_caption_render_spec_version int,batch_target_key text,batch_target_release_id text,batch_job_definition text,batch_job_queue text);
    create table shorts_mvp.generated_shorts(id uuid primary key,pending_edit_snapshot jsonb,pending_edit_request_id uuid,constraint generated_shorts_pending_edit_request_check check (true));
    create table shorts_mvp.ordinary_guard_log(n int);
    create function shorts_mvp.enforce_project_target_successor_admission() returns trigger language plpgsql as $$
begin
  insert into shorts_mvp.ordinary_guard_log values (1);
  return new;
end; $$;
    create trigger admission before insert on shorts_mvp.video_jobs for each row execute function shorts_mvp.enforce_project_target_successor_admission();`);
  await db.exec(await readFile(new URL("../../supabase/migrations/202611030001_admin_midform_projects.sql", import.meta.url), "utf8"));
  await db.exec(`insert into shorts_mvp.midform_releases(id,registry,editor_job_queue_arn,verified_at) values ('${release}','{}','queue',now())`);
});
afterAll(async () => { await db?.close(); });
function insert(owner: string, id: string, source = "upload") {
  return db.exec(`insert into shorts_mvp.video_jobs(id,user_id,source_type,planned_short_count,initial_editor_release_id,pipeline_version,initial_render_spec_version,initial_caption_render_spec_version,midform_release_id,midform_request) values ('${id}','${owner}','${source}',1,'${release}',2,4,4,'${release}','{"version":1,"targetSeconds":0}')`);
}
describe("midform DB boundary", () => {
  it("keeps ordinary admission unchanged", async () => {
    await db.exec(`insert into shorts_mvp.video_jobs(id,user_id) values ('44444444-4444-4444-8444-444444444444','${user}')`);
    expect((await db.query("select count(*)::int as n from shorts_mvp.ordinary_guard_log")).rows).toEqual([{ n: 1 }]);
  });
  it("rejects non-admin inserts regardless of client payload", async () => {
    await expect(insert(user,"55555555-5555-4555-8555-555555555555")).rejects.toThrow("MIDFORM_ADMIN_REQUIRED");
  });
  it("requires a matching pinned target for link creation", async () => {
    await expect(insert(admin,"66666666-6666-4666-8666-666666666666","youtube")).rejects.toThrow("MIDFORM_TARGET_MISMATCH");
  });
  it("prevents turning an admitted private job into a public example or changing its owner", async () => {
    const id = "77777777-7777-4777-8777-777777777777";
    await insert(admin,id);
    await expect(db.exec(`update shorts_mvp.video_jobs set is_example=true where id='${id}'`)).rejects.toThrow("MIDFORM_IDENTITY_IMMUTABLE");
    await expect(db.exec(`update shorts_mvp.video_jobs set user_id='${user}' where id='${id}'`)).rejects.toThrow("MIDFORM_IDENTITY_IMMUTABLE");
    await expect(db.exec(`update shorts_mvp.video_jobs set midform_request=null where id='${id}'`)).rejects.toThrow("MIDFORM_IDENTITY_IMMUTABLE");
  });
});
