import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_TARGET_LANES,
  productionProjectTargetEnvironment,
  readProductionProjectTargets,
  validateLiveProductionProjectTargetTransition,
  validateProductionProjectTargets,
} from "./production-project-targets.mjs";

const registry = readProductionProjectTargets();

test("pins all five production lanes and the exact unified rotation pair", () => {
  assert.deepEqual(Object.keys(registry.lanes), Object.keys(PROJECT_TARGET_LANES));
  const unified = registry.lanes.unified_template_subtitles;
  assert.equal(unified.schedulingMode, "fifo");
  assert.match(unified.current.jobDefinitionArn, /f28e1fe874c1-4vcpu:4$/);
  assert.match(unified.previous.jobDefinitionArn, /8fa1f8494a49-4vcpu:1$/);
  assert.equal(
    unified.current.workerSourceGitSha,
    "f28e1fe874c1bff1da6184088ef1ee48e8418dc5",
  );
  assert.match(unified.current.imageUri, /@sha256:f451682b1468c918/);
  assert.equal(
    unified.previous.workerSourceGitSha,
    "8fa1f8494a491c1e3b8d23c18ffcdf36581c12b5",
  );
  assert.match(unified.previous.imageUri, /@sha256:9e40d290f774359a/);
  assert.equal(unified.previous.jobQueueArn, unified.current.jobQueueArn);
  assert.equal(unified.previous.submitAsReleaseId, unified.current.releaseId);
  assert.doesNotMatch(JSON.stringify(registry), /f586/i);
});

test("exports exact current release IDs and the immutable registry JSON", () => {
  const environment = productionProjectTargetEnvironment(registry);
  for (const prefix of Object.values(PROJECT_TARGET_LANES)) {
    assert.ok(environment[`${prefix}_BATCH_TARGET_RELEASE_ID`]);
    assert.ok(environment[`${prefix}_JOB_DEFINITION_ARN`]);
    assert.ok(environment[`${prefix}_BATCH_QUEUE_ARN`]);
    assert.match(environment[`${prefix}_WORKER_SOURCE_GIT_SHA`], /^[0-9a-f]{40}$/);
    assert.match(environment[`${prefix}_WORKER_IMAGE_DIGEST`], /^sha256:[0-9a-f]{64}$/);
  }
  assert.deepEqual(
    JSON.parse(environment.PROJECT_TARGET_REGISTRY_JSON),
    registry,
  );
});

test("accepts and exports only the complete exact v4 capability triple", () => {
  const v4 = structuredClone(registry);
  const target = v4.lanes.legacy_project.current;
  target.renderSpecVersion = 4;
  target.captionRenderSpecVersion = 4;
  target.fontManifestSha256 = "a".repeat(64);

  assert.doesNotThrow(() => validateProductionProjectTargets(v4));
  const environment = productionProjectTargetEnvironment(v4);
  assert.equal(environment.LEGACY_PROJECT_RENDER_SPEC_VERSION, "4");
  assert.equal(environment.LEGACY_PROJECT_CAPTION_RENDER_SPEC_VERSION, "4");
  assert.equal(
    environment.LEGACY_PROJECT_FONT_MANIFEST_SHA256,
    "a".repeat(64),
  );

  const partial = structuredClone(v4);
  delete partial.lanes.legacy_project.current.fontManifestSha256;
  assert.throws(
    () => validateProductionProjectTargets(partial),
    /capability triple이 완전하지/,
  );

  const wrongVersion = structuredClone(v4);
  wrongVersion.lanes.legacy_project.current.renderSpecVersion = 3;
  assert.throws(
    () => validateProductionProjectTargets(wrongVersion),
    /capability triple이 올바르지/,
  );
});

test("rejects unknown lanes, mutable definitions, and unsafe previous targets", () => {
  assert.throws(
    () => validateProductionProjectTargets({
      ...registry,
      lanes: { ...registry.lanes, surprise_lane: registry.lanes.legacy_project },
    }),
    /키가 정확하지/,
  );
  assert.throws(
    () => validateProductionProjectTargets({
      ...registry,
      lanes: {
        ...registry.lanes,
        unified_template_subtitles: {
          ...registry.lanes.unified_template_subtitles,
          current: {
            ...registry.lanes.unified_template_subtitles.current,
            jobDefinitionArn: registry.lanes.unified_template_subtitles.current
              .jobDefinitionArn.replace(/:4$/, ""),
          },
        },
      },
    }),
    /ARN이 정확하지/,
  );
  assert.throws(
    () => validateProductionProjectTargets({
      ...registry,
      lanes: {
        ...registry.lanes,
        unified_template_subtitles: {
          ...registry.lanes.unified_template_subtitles,
          previous: {
            ...registry.lanes.unified_template_subtitles.previous,
            submitAsReleaseId: "some-other-release",
          },
        },
      },
    }),
    /같은 lane release/,
  );
  assert.throws(
    () => validateProductionProjectTargets({
      ...registry,
      lanes: {
        ...registry.lanes,
        unified_template_subtitles: {
          ...registry.lanes.unified_template_subtitles,
          current: {
            ...registry.lanes.unified_template_subtitles.current,
            workerSourceGitSha: "f28e1fe874c1",
          },
        },
      },
    }),
    /workerSourceGitSha/,
  );
  assert.throws(
    () => validateProductionProjectTargets({
      ...registry,
      lanes: {
        ...registry.lanes,
        unified_template_subtitles: {
          ...registry.lanes.unified_template_subtitles,
          current: {
            ...registry.lanes.unified_template_subtitles.current,
            imageUri: registry.lanes.unified_template_subtitles.current.imageUri
              .replace("181651591905", "999999999999"),
          },
        },
      },
    }),
    /Worker image.*계정\/리전/,
  );
});

test("allows a previous release to execute itself when no hardening remap is declared", () => {
  const selfExecuting = structuredClone(registry);
  delete selfExecuting.lanes.unified_template_subtitles.previous.submitAsReleaseId;
  assert.doesNotThrow(() => validateProductionProjectTargets(selfExecuting));
  const environment = productionProjectTargetEnvironment(selfExecuting);
  assert.equal(
    environment.UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_SUBMIT_AS_RELEASE_ID,
    undefined,
  );
});

test("rejects a shared queue with conflicting scheduling modes", () => {
  const conflicting = structuredClone(registry);
  conflicting.lanes.unified_template_subtitles.current.jobQueueArn =
    conflicting.lanes.legacy_project.current.jobQueueArn;
  conflicting.lanes.unified_template_subtitles.previous.jobQueueArn =
    conflicting.lanes.legacy_project.current.jobQueueArn;
  assert.throws(
    () => validateProductionProjectTargets(conflicting),
    /상충하는 schedulingMode/,
  );
});

function liveAdmissionEnvironment(value = registry) {
  return Object.fromEntries(
    Object.entries(PROJECT_TARGET_LANES).flatMap(([laneName, prefix]) => ([
      [
        `${prefix}_JOB_DEFINITION_ARN`,
        value.lanes[laneName].current.jobDefinitionArn,
      ],
      [
        `${prefix}_BATCH_QUEUE_ARN`,
        value.lanes[laneName].current.jobQueueArn,
      ],
    ])),
  );
}

test("requires every live admission ARN pair to remain in candidate current or previous", () => {
  const live = liveAdmissionEnvironment();
  assert.deepEqual(
    Object.keys(validateLiveProductionProjectTargetTransition(live, registry)),
    Object.keys(PROJECT_TARGET_LANES),
  );

  const rotated = structuredClone(registry);
  const liveLegacy = rotated.lanes.legacy_project.current;
  rotated.lanes.legacy_project.current = {
    ...liveLegacy,
    releaseId: "legacy-project-ccccccc-r2",
    workerSourceGitSha: "c".repeat(40),
    imageUri: liveLegacy.imageUri.replace(/sha256:[0-9a-f]{64}$/, `sha256:${"c".repeat(64)}`),
    jobDefinitionArn: liveLegacy.jobDefinitionArn.replace(
      /job-definition\/[^:]+:[1-9][0-9]*$/,
      "job-definition/shorts-mvp-project-heavy-pot-ccccccc-production:2",
    ),
  };
  rotated.lanes.legacy_project.previous = liveLegacy;
  assert.equal(
    validateLiveProductionProjectTargetTransition(live, rotated).legacy_project,
    liveLegacy.releaseId,
  );

  rotated.lanes.legacy_project.previous.submitAsReleaseId =
    rotated.lanes.legacy_project.current.releaseId;
  assert.throws(
    () => validateLiveProductionProjectTargetTransition(live, rotated),
    /legacy_project admission target.*previous.*자기 자신이어야 합니다/,
  );
  rotated.lanes.legacy_project.previous.submitAsReleaseId = liveLegacy.releaseId;
  assert.equal(
    validateLiveProductionProjectTargetTransition(live, rotated).legacy_project,
    liveLegacy.releaseId,
  );

  rotated.lanes.legacy_project.previous = null;
  assert.throws(
    () => validateLiveProductionProjectTargetTransition(live, rotated),
    /legacy_project admission target.*보존되지 않았습니다/,
  );
});

test("fails closed when a live admission target pair cannot be read", () => {
  const live = liveAdmissionEnvironment();
  delete live.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN;
  assert.throws(
    () => validateLiveProductionProjectTargetTransition(live, registry),
    /subtitle_templates admission target ARN 쌍을 확인할 수 없습니다/,
  );
});
