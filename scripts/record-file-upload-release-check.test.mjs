import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./record-file-upload-release-check.mjs", import.meta.url),
  "utf8",
);

test("release check recorder is evidence-bound and production-identity guarded", () => {
  assert.match(source, /requireProductionDatabaseUrl\(\)/);
  assert.match(source, /evidenceId/);
  assert.match(source, /sourceGitSha/);
  assert.match(source, /observedAt/);
  assert.match(source, /record_file_upload_release_check/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|FILE_UPLOAD_TOKEN_SECRET/);
});
