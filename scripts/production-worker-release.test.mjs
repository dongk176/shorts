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
    "df9e8d60ee925923251d160f8dfabf5f92191e17",
  );
  assert.equal(
    release.imageDigest,
    "sha256:b80baba150464e7ef6e8475595d280f9d69b8a1821a152f6b18a8e9d23083cdd",
  );
  assert.equal(release.ingestionAttemptBudget, 20);
  assert.equal(release.batchRetryAttempts, 1);
  assert.ok(release.imageUri.endsWith(`@${release.imageDigest}`));
});

test("maps all five registry lanes to the web and Lambda environment contract", () => {
  const environment = productionWorkerEnvironment(release);
  for (const prefix of [
    "LEGACY_PROJECT",
    "SOURCE_RANGE",
    "ELEVENLABS_TRANSCRIPTION",
    "SUBTITLE_TEMPLATES",
    "UNIFIED_TEMPLATE_SUBTITLES",
  ]) {
    assert.ok(environment[`${prefix}_JOB_DEFINITION_ARN`]);
    assert.ok(environment[`${prefix}_BATCH_QUEUE_ARN`]);
    assert.ok(environment[`${prefix}_BATCH_TARGET_RELEASE_ID`]);
  }
  assert.ok(environment.PROJECT_TARGET_REGISTRY_JSON);
});

test("passes the exact registry JSON as the sole production CDK target context", () => {
  const context = productionWorkerCdkContext(release);
  assert.deepEqual(Object.keys(context), ["projectTargetRegistryJson"]);
  const registry = JSON.parse(context.projectTargetRegistryJson);
  assert.equal(
    registry.lanes.legacy_project.current.jobDefinitionArn,
    release.targets.legacyProject.jobDefinitionArn,
  );
});

test("rejects mutable images, stale budgets, shared definitions, and registry drift", () => {
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
  assert.throws(
    () => validateProductionWorkerRelease({
      ...release,
      targets: {
        ...release.targets,
        legacyProject: {
          ...release.targets.legacyProject,
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:181651591905:job-queue/drifted",
        },
      },
    }),
    /registry와 다릅니다/,
  );
});
