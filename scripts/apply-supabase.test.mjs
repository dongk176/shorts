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

test("the full migration replay keeps exactly the two curated public examples", () => {
  const retiredMigrationName = "202607290006_retire_public_examples.sql";
  const retiredMigration = fs.readFileSync(
    new URL(`../supabase/migrations/${retiredMigrationName}`, import.meta.url),
    "utf8",
  );
  const curatedMigrationName = "202607290007_restore_two_public_examples.sql";
  const curatedMigration = fs.readFileSync(
    new URL(`../supabase/migrations/${curatedMigrationName}`, import.meta.url),
    "utf8",
  );

  assert.ok(retiredMigrationName > "202607210001_retain_example_projects.sql");
  assert.ok(curatedMigrationName > retiredMigrationName);
  assert.match(retiredMigration, /set is_example = false/);
  assert.match(curatedMigration, /set is_example = true/);
  for (const publicProjectId of [
    "aa9f0409-4dfd-47fa-8014-a0091cb8d08d",
    "ed706a47-1238-4243-9984-a361ca9595cf",
  ]) {
    assert.match(curatedMigration, new RegExp(publicProjectId));
  }
  for (const retiredProjectId of [
    "a8e6ea45-89e1-4a3e-a2b7-4b297ce439dc",
    "cf3211c5-8cc2-45f4-af99-cab3c7b98d13",
    "ddf33f5f-03d1-43e6-abd4-50cf163445d0",
  ]) {
    assert.match(curatedMigration, new RegExp(retiredProjectId));
  }
});
