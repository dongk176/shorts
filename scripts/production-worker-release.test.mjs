import assert from "node:assert/strict";
import test from "node:test";
import {
  productionWorkerCdkContext,
  productionWorkerEnvironment,
  readProductionWorkerRelease,
  validateProductionWorkerRelease,
} from "./production-worker-release.mjs";

const release = readProductionWorkerRelease();

test("pins the proven production worker source and immutable image digest", () => {
  assert.equal(
    release.workerSourceGitSha,
    "f8623974c7528ce9142af63d8f4d925df55f2641",
  );
  assert.equal(
    release.imageDigest,
    "sha256:2e8685bf5324645f9133dafeabecb06352c6a205c1e11f36cbf4d55844e53840",
  );
  assert.equal(release.ingestionAttemptBudget, 20);
  assert.equal(release.batchRetryAttempts, 1);
  assert.ok(release.imageUri.endsWith(`@${release.imageDigest}`));
});

test("maps all four release targets to the web and Lambda environment contract", () => {
  const environment = productionWorkerEnvironment(release);
  assert.deepEqual(Object.keys(environment).sort(), [
    "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
    "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
    "LEGACY_PROJECT_BATCH_QUEUE_ARN",
    "LEGACY_PROJECT_JOB_DEFINITION_ARN",
    "SOURCE_RANGE_BATCH_QUEUE_ARN",
    "SOURCE_RANGE_JOB_DEFINITION_ARN",
    "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
    "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
  ]);
});

test("maps the same release targets to the production CDK context", () => {
  const context = productionWorkerCdkContext(release);
  assert.deepEqual(Object.keys(context).sort(), [
    "elevenLabsTranscriptionBatchQueueArn",
    "elevenLabsTranscriptionJobDefinitionArn",
    "legacyProjectBatchQueueArn",
    "legacyProjectJobDefinitionArn",
    "sourceRangeBatchQueueArn",
    "sourceRangeJobDefinitionArn",
    "subtitleTemplatesBatchQueueArn",
    "subtitleTemplatesJobDefinitionArn",
  ]);
  assert.equal(
    context.legacyProjectJobDefinitionArn,
    release.targets.legacyProject.jobDefinitionArn,
  );
});

test("rejects mutable images, stale budgets, and shared definitions", () => {
  assert.throws(
    () => validateProductionWorkerRelease({ ...release, imageUri: "example.invalid/worker:latest" }),
    /고정 digest/,
  );
  assert.throws(
    () => validateProductionWorkerRelease({ ...release, ingestionAttemptBudget: 21 }),
    /정확히 20/,
  );
  assert.throws(
    () => validateProductionWorkerRelease({
      ...release,
      targets: {
        ...release.targets,
        subtitleTemplates: { ...release.targets.elevenLabsTranscription },
      },
    }),
    /서로 달라야/,
  );
});
