import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import {
  validateVercelProjectLink,
} from "./verify-vercel-project-link.mjs";

const source = fs.readFileSync(
  new URL("./sync-production-project-target-env.sh", import.meta.url),
  "utf8",
);

test("syncs only exact production project target and provenance variables", () => {
  const names = [
    "LEGACY_PROJECT_JOB_DEFINITION_ARN",
    "LEGACY_PROJECT_BATCH_QUEUE_ARN",
    "LEGACY_PROJECT_BATCH_TARGET_RELEASE_ID",
    "SOURCE_RANGE_JOB_DEFINITION_ARN",
    "SOURCE_RANGE_BATCH_QUEUE_ARN",
    "SOURCE_RANGE_BATCH_TARGET_RELEASE_ID",
    "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
    "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
    "ELEVENLABS_TRANSCRIPTION_BATCH_TARGET_RELEASE_ID",
    "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
    "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
    "SUBTITLE_TEMPLATES_BATCH_TARGET_RELEASE_ID",
    "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN",
    "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN",
    "UNIFIED_TEMPLATE_SUBTITLES_BATCH_TARGET_RELEASE_ID",
    "LEGACY_PROJECT_WORKER_SOURCE_GIT_SHA",
    "LEGACY_PROJECT_WORKER_IMAGE_DIGEST",
    "SOURCE_RANGE_WORKER_SOURCE_GIT_SHA",
    "SOURCE_RANGE_WORKER_IMAGE_DIGEST",
    "ELEVENLABS_TRANSCRIPTION_WORKER_SOURCE_GIT_SHA",
    "ELEVENLABS_TRANSCRIPTION_WORKER_IMAGE_DIGEST",
    "SUBTITLE_TEMPLATES_WORKER_SOURCE_GIT_SHA",
    "SUBTITLE_TEMPLATES_WORKER_IMAGE_DIGEST",
    "UNIFIED_TEMPLATE_SUBTITLES_WORKER_SOURCE_GIT_SHA",
    "UNIFIED_TEMPLATE_SUBTITLES_WORKER_IMAGE_DIGEST",
  ];

  for (const name of names) assert.match(source, new RegExp(`\\n  ${name}\\n`));
  assert.match(source, /for name in "\$\{target_names\[@\]\}"/);
  assert.match(source, /vercel env add "\$name" production/);
  assert.match(source, /--value "\$value"/);
  assert.match(source, /--yes/);
  assert.doesNotMatch(source, /--no-sensitive/);
  assert.doesNotMatch(source, /< "\$value_file"/);
  assert.match(source, /verify-production-worker-release\.mjs/);
  assert.match(source, /verify-project-batch-targets\.mjs/);
  assert.match(source, /verify-vercel-project-target-env-metadata\.mjs/);
  assert.match(source, /--print-stale-optional/);
  assert.match(source, /vercel env rm "\$stale_optional_name" production/);
  assert.match(source, /vercel api "\/v9\/projects\/\$VERCEL_PROJECT_NAME"/);
  assert.match(source, /verify-vercel-project-link\.mjs/);
  assert.match(source, /registry_env_file="\$\(mktemp\)"/);
  assert.doesNotMatch(source, /declare\s+-A/);
  assert.doesNotMatch(source, /TOSS_|THEPAYONE_|DATABASE_URL|SUPABASE_/);
});

test("uses syntax supported by the macOS system bash", () => {
  const result = spawnSync("/bin/bash", ["-n", new URL(
    "./sync-production-project-target-env.sh",
    import.meta.url,
  ).pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("fails closed when an existing Vercel link differs from the live project", () => {
  const live = {
    id: "prj_expected",
    name: "shorts",
    accountId: "team_expected",
  };
  const linked = {
    projectId: "prj_expected",
    projectName: "shorts",
    orgId: "team_expected",
  };
  assert.deepEqual(
    validateVercelProjectLink(linked, live, "shorts"),
    linked,
  );
  for (const [field, value] of [
    ["projectId", "prj_wrong"],
    ["projectName", "other-project"],
    ["orgId", "team_wrong"],
  ]) {
    assert.throws(
      () => validateVercelProjectLink({ ...linked, [field]: value }, live, "shorts"),
      new RegExp(field),
    );
  }
  assert.throws(
    () => validateVercelProjectLink(linked, { ...live, name: "other" }, "shorts"),
    /live project name/,
  );
});
