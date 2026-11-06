import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { it, expect } from "vitest";

// Exercise the worker's actual SQL, not a rewritten copy of its queries.
const queries: string[] = JSON.parse(execFileSync("python3", ["-c", `
import ast,json
m=ast.parse(open('../worker/shorts_worker/repository.py').read())
methods=[n for n in ast.walk(m) if isinstance(n,ast.FunctionDef) and n.name in ('complete_initial_render','inline_silence_admin_allowed')]
print(json.dumps([n.value for m in methods for n in ast.walk(m) if isinstance(n,ast.Constant) and isinstance(n.value,str) and ('select ' in n.value or 'update ' in n.value or 'insert ' in n.value)]))
`], { encoding: "utf8" }));
const sql = (match: string) => {
  let i = 0;
  return queries.find(q => q.includes(match))!.replaceAll("%s", () => `$${++i}`);
};
const admin = "11111111-1111-4111-8111-111111111111";
const job = "22222222-2222-4222-8222-222222222222";
const short = "33333333-3333-4333-8333-333333333333";
it("admits only opted-in administrators and atomically stores output with its edit map", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema shorts_mvp;
      create table shorts_mvp.app_users(id uuid primary key,is_admin boolean not null);
      create table shorts_mvp.runtime_feature_flags(flag_key text primary key,enabled boolean not null,description text);
      create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,is_example boolean,midform_request jsonb,template_snapshot jsonb,
        output_language text default 'ko',status text default 'rendering',deadline_at timestamptz default now()+interval '1 hour',pipeline_version int default 2);
      create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,
        custom_template_id uuid,template_snapshot jsonb default '{}', render_version int default 1,editor_document jsonb,
        initial_render_spec jsonb default '{"version":4}',editor_document_version int,duration_seconds numeric default 4,
        start_seconds numeric default 10,end_seconds numeric default 14,
        initial_start_seconds numeric,initial_end_seconds numeric,
        constraint generated_shorts_duration_range_check check
          (duration_seconds>=1 and end_seconds>start_seconds and duration_seconds=end_seconds-start_seconds),
        output_s3_key text,thumbnail_s3_key text,file_size_bytes bigint,status text default 'rendering',render_progress int,
        rendered_config_hash text,hook_title text,channel_display_name text,subtitles_enabled boolean,
        subtitle_segments jsonb,comment_overlays jsonb,template_id text,video_aspect_ratio text,title_font_scale numeric,
        title_text_styles jsonb,title_text_styles_initialized boolean,subtitle_template_id text,
        subtitle_template_snapshot jsonb,caption_render_spec jsonb,render_error_code text,render_error_message text);
      insert into shorts_mvp.app_users values ('${admin}',true);
      insert into shorts_mvp.video_jobs(id,user_id,is_example,template_snapshot) values
        ('${job}','${admin}',false,'{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}');
      insert into shorts_mvp.generated_shorts(id,job_id,user_id) values ('${short}','${job}','${admin}');`);
    for (const migration of ["20261104050801_admin_shorts_silence_tasks.sql", "20261104171115_public_shorts_silence.sql"]) {
      await db.exec(readFileSync(`../supabase/migrations/${migration}`, "utf8"));
    }
    await db.exec("update shorts_mvp.runtime_feature_flags set enabled=true where flag_key='admin_shorts_silence'");
    const admit = (publicEnabled = false) => db.query(sql("select 1 from shorts_mvp.generated_shorts s"), [short, publicEnabled]);
    expect((await admit()).rows).toHaveLength(1);
    await db.exec("update shorts_mvp.app_users set is_admin=false");
    expect((await admit()).rows).toHaveLength(0);
    expect((await admit(true)).rows).toHaveLength(0);
    await db.exec("update shorts_mvp.runtime_feature_flags set enabled=true where flag_key='public_shorts_silence'");
    expect((await admit(true)).rows).toHaveLength(1);
    expect((await admit()).rows).toHaveLength(0);
    await db.exec("update shorts_mvp.video_jobs set output_language='ja'");
    expect((await admit(true)).rows).toHaveLength(1);
    await db.exec("update shorts_mvp.video_jobs set output_language='ko'");
    await db.exec("update shorts_mvp.app_users set is_admin=true");
    const save = async (invalidOwner: boolean) => db.transaction(async tx => {
      await tx.query(sql("update shorts_mvp.generated_shorts s"), ["new.mp4", "new.jpg", 100, short]);
      await tx.query(sql("set editor_document=%s"), [{ version: 3 }, 2.2, 2.2, short]);
      if (invalidOwner) await tx.exec("update shorts_mvp.video_jobs set template_snapshot='{}'");
      const task = await tx.query(sql("insert into shorts_mvp.admin_short_silence_tasks"), ["completed", 1, 1.8, null, short]);
      if (!task.rows.length) throw new Error("administrator revoked");
    });
    await expect(save(true)).rejects.toThrow("SILENCE_OWNERSHIP_REQUIRED");
    expect((await db.query("select status,editor_document,output_s3_key from shorts_mvp.generated_shorts")).rows)
      .toEqual([{ status: "rendering", editor_document: null, output_s3_key: null }]);
    await save(false);
    expect((await db.query("select start_seconds,end_seconds,duration_seconds,initial_start_seconds,initial_end_seconds from shorts_mvp.generated_shorts")).rows)
      .toEqual([{ start_seconds: "10", end_seconds: "12.2", duration_seconds: "2.2", initial_start_seconds: "10", initial_end_seconds: "14" }]);
    expect((await db.query("select state,cut_count from shorts_mvp.admin_short_silence_tasks")).rows)
      .toEqual([{ state: "completed", cut_count: 1 }]);
    expect((await admit()).rows).toHaveLength(0);
    // A failed optional analysis commits the original output and a terminal
    // failure together. The old postprocessor must not claim it again.
    await db.exec(`delete from shorts_mvp.admin_short_silence_tasks;
      update shorts_mvp.generated_shorts set status='rendering',editor_document=null;
      update shorts_mvp.app_users set is_admin=false`);
    await db.transaction(async tx => {
      await tx.query(sql("update shorts_mvp.generated_shorts s"), ["fallback.mp4", "fallback.jpg", 100, short]);
      await tx.query(sql("insert into shorts_mvp.admin_short_silence_tasks"),
        ["failed", 0, 0, "SILENCE_INLINE_ANALYSIS_FAILED", short]);
    });
    expect((await db.query("select status,output_s3_key from shorts_mvp.generated_shorts")).rows)
      .toEqual([{ status: "ready", output_s3_key: "fallback.mp4" }]);
    expect((await db.query("select state,error_code from shorts_mvp.admin_short_silence_tasks")).rows)
      .toEqual([{ state: "failed", error_code: "SILENCE_INLINE_ANALYSIS_FAILED" }]);
    expect((await admit(true)).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 30_000);
