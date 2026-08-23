import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("forwards selected migration filenames to the migration runner", () => {
  const wrapper = fs.readFileSync(
    new URL("./apply-supabase.sh", import.meta.url),
    "utf8",
  );
  assert.match(wrapper, /node scripts\/apply-supabase\.mjs "\$@"/);
});

test("runs concurrent index migrations outside an implicit transaction", () => {
  const runner = fs.readFileSync(
    new URL("./apply-supabase.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /concurrentIndexPattern/);
  assert.match(runner, /split\(\/;\\s\*/);
  assert.match(runner, /for \(const statement of statements\)/);
  assert.match(runner, /await sql\.unsafe\(statement/);
  assert.match(runner, /begin\|commit\|rollback/);
});

function creationBlockCodes(file) {
  const migration = fs.readFileSync(
    new URL(`../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
  const values = migration.match(/creation_block_code in \(([\s\S]*?)\)/);
  assert.ok(values, `${file} must define creation_block_code values`);
  return new Set([...values[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

test("replayed availability migration accepts every current playback block code", () => {
  const replayedCodes = creationBlockCodes("202607150008_youtube_creation_availability.sql");
  const currentCodes = creationBlockCodes("202607170002_youtube_playback_availability.sql");

  for (const code of currentCodes) {
    assert.ok(replayedCodes.has(code), `${code} is missing from the replayed constraint`);
  }
});

test("direct service access can reserve only explicitly granted processing time", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202607280005_direct_service_usage_reservations.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /manual_service_access_until\s*>\s*clock_timestamp\(\)/,
  );
  assert.match(
    migration,
    /g\.user_id=p_user_id and g\.status='active'/,
  );
  assert.match(
    migration,
    /g\.total_seconds\s*>\s*g\.reserved_seconds\+g\.consumed_seconds/,
  );
});

test("managed password accounts keep passwords in Supabase Auth and private tables", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202607290004_managed_password_accounts.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(migration, /password_(?:hash|salt)|\bpassword text\b/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /managed_login_accounts enable row level security/);
  assert.match(migration, /revoke all on shorts_mvp\.managed_login_accounts from anon, authenticated/);
  assert.match(migration, /popular_filter_enabled boolean not null default false/);
});

test("subtitle template canary is additive, disabled, and schema isolated", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608080001_subtitle_templates_admin_canary.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /set local lock_timeout = '3s'/);
  assert.match(migration, /add column if not exists subtitle_template_id text/);
  assert.match(migration, /add column if not exists caption_render_spec jsonb/);
  assert.match(migration, /subtitle_template_id in \('basic','highlight','pop'\)/);
  assert.match(migration, /add constraint video_jobs_subtitle_template_check[\s\S]*not valid/);
  assert.match(
    migration,
    /subtitle_template_snapshot->>'subtitleTemplateId'\)[\s\n]*is not distinct from subtitle_template_id/,
  );
  assert.match(
    migration,
    /caption_render_spec->>'templateId'\)[\s\n]*is not distinct from subtitle_template_id/,
  );
  assert.match(migration, /subtitle template identity is immutable/);
  assert.match(migration, /'subtitle_templates',[\s\S]*false/);
  assert.match(migration, /'subtitle_templates_public',[\s\S]*false/);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table|function)\s+public\./i);
});

test("file upload control plane is additive, private, and disabled by default", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608230003_file_upload_admin_control_plane.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const validation = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608230004_file_upload_admin_control_plane_validate.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /add column if not exists source_type text not null default 'youtube'/);
  assert.match(migration, /check \(source_type in \('youtube','upload'\)\) not valid/);
  assert.match(migration, /create table if not exists shorts_mvp\.upload_sessions/);
  for (const field of [
    "job_id", "user_id", "request_id", "token_hash", "expected_bytes",
    "expires_at", "claimed_at", "consumed_at", "original_filename",
    "declared_content_type", "probe_metadata", "source_thumbnail_s3_key",
    "source_deleted_at", "heartbeat_at", "failure_reason",
  ]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`), `${field} is missing`);
  }
  assert.match(migration, /upload_sessions enable row level security/);
  assert.match(migration, /revoke all on shorts_mvp\.upload_sessions from anon, authenticated/);
  assert.match(migration, /'file_upload',[\s\S]*false/);
  assert.match(migration, /'file_upload_public',[\s\S]*false/);
  assert.match(validation, /validate constraint video_jobs_source_type_check/);
  assert.doesNotMatch(migration, /insert into shorts_mvp\.(?:video_jobs|usage_reservations|project_job_outbox)/i);
  assert.doesNotMatch(migration, /alter column (?:youtube_url|youtube_video_id) drop not null/i);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table|function)\s+public\./i);
});

test("file upload idempotency binds request ids to immutable intents", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608230008_file_upload_intent_hash.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /alter table shorts_mvp\.upload_sessions/);
  assert.match(migration, /add column if not exists intent_hash text/);
  assert.match(migration, /alter column intent_hash set not null/);
  assert.match(migration, /intent_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(migration, /shorts_mvp\.(?:video_jobs|generated_shorts|usage_events)/);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table|function)\s+public\./i);
});
