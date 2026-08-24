import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("./sync-vercel-env.sh", import.meta.url), "utf8");

test("syncs the server-side Supabase Auth configuration to Vercel", () => {
  assert.match(script, /for name in[^\n]*DATABASE_URL SUPABASE_URL SUPABASE_PUBLISHABLE_KEY/);
});

test("syncs default and package ThePayOne credentials to Vercel", () => {
  assert.match(script, /THEPAYONE_BILLING_ENABLED THEPAYONE_MID THEPAYONE_TERMINAL_ID THEPAYONE_PAY_KEY/);
  assert.match(script, /THEPAYONE_PACKAGE_BILLING_ENABLED THEPAYONE_PACKAGE_MID/);
  assert.match(script, /THEPAYONE_PACKAGE_TERMINAL_ID THEPAYONE_PACKAGE_PAY_KEY/);
  assert.match(script, /THEPAYONE_PACKAGE_PAYMENT_MODE THEPAYONE_ADDON_PAYMENT_MODE/);
});

test("syncs both server-side editor release master switches", () => {
  assert.match(script, /EDITOR_RENDERING_V2_ENABLED/);
  assert.match(script, /EDITOR_RENDERING_V2_GLOBAL_ENABLED/);
});

test("verifies and syncs every immutable project Batch target", () => {
  const releaseGuard = script.indexOf("verify-production-worker-release.mjs");
  const guard = script.indexOf("verify-project-batch-targets.mjs");
  const firstWrite = script.indexOf('vercel env add "$name"');
  assert.ok(releaseGuard >= 0 && releaseGuard < firstWrite);
  assert.ok(guard >= 0 && guard < firstWrite);
  for (const name of [
    "LEGACY_PROJECT_JOB_DEFINITION_ARN",
    "LEGACY_PROJECT_BATCH_QUEUE_ARN",
    "SOURCE_RANGE_JOB_DEFINITION_ARN",
    "SOURCE_RANGE_BATCH_QUEUE_ARN",
    "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
    "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
    "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
    "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
    "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN",
    "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN",
  ]) {
    assert.match(script, new RegExp(`\\b${name}\\b`));
  }
  for (const name of [
    "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN",
    "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN",
  ]) {
    const required = script.indexOf(`\${${name}:?${name} is required}`);
    assert.ok(required >= 0 && required < guard && required < firstWrite);
  }
});
