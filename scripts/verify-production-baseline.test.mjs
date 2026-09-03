import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractSqlFunctionBody,
  migrationPathForSqlFunction,
} from "./verify-production-baseline.mjs";

const manifest = JSON.parse(readFileSync("production-baseline.json", "utf8"));
test("captured ingestion function bodies match the live production hashes", () => {
  for (const [signature, expected] of Object.entries(manifest.database.functionBodyMd5)) {
    const name = signature.slice(0, signature.indexOf("("));
    const migration = readFileSync(
      migrationPathForSqlFunction(manifest, name),
      "utf8",
    );
    const actual = crypto
      .createHash("md5")
      .update(extractSqlFunctionBody(migration, name))
      .digest("hex");
    assert.equal(actual, expected, signature);
  }
});

test("production baseline tracks the later project outbox override separately", () => {
  assert.equal(
    migrationPathForSqlFunction(manifest, "claim_project_job_outbox"),
    manifest.sourceFiles.projectOutboxMigration,
  );
  assert.equal(
    migrationPathForSqlFunction(manifest, "ingestion_route_quality"),
    manifest.sourceFiles.ingestionDatabaseMigration,
  );
});

test("production baseline records disabled custom design and excludes publishing", () => {
  assert.equal(manifest.database.featureFlags.custom_template_design_enabled, false);
  assert.equal(manifest.database.featureFlags.custom_template_design_public, false);
  assert.equal(manifest.releaseRules.unfinishedContentCalendarExcluded, true);
  assert.equal(manifest.releaseRules.youtubePublishingExperimentExcluded, true);
});

test("production baseline keeps Render and Caption Spec v4 aligned", () => {
  assert.equal(manifest.aws.projectWorker.renderSpecVersion, 4);
  assert.equal(manifest.aws.projectWorker.captionRenderSpecVersion, 4);
  assert.equal(manifest.aws.fileUploadReceiver.renderSpecVersion, 4);
  assert.equal(manifest.aws.fileUploadReceiver.captionRenderSpecVersion, 4);
  assert.equal(
    manifest.aws.projectWorker.fontManifestSha256,
    manifest.aws.fileUploadReceiver.fontManifestSha256,
  );
});
