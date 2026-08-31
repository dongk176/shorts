import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_TARGET_LANES,
  productionProjectTargetEnvironment,
  productionProjectTargetsFingerprint,
  readProductionProjectTargets,
  validateLiveProductionProjectTargetTransition,
  validateProductionProjectTargets,
} from "./production-project-targets.mjs";

const registry = readProductionProjectTargets();

test("pins all five production lanes and the approved unified rotation states", () => {
  assert.deepEqual(Object.keys(registry.lanes), Object.keys(PROJECT_TARGET_LANES));
  const unified = registry.lanes.unified_template_subtitles;
  const oldCurrent = {
    releaseId: "unified-source-range-f28e1fe874c1-r1",
    workerSourceGitSha: "f28e1fe874c1bff1da6184088ef1ee48e8418dc5",
    imageUri: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:f451682b1468c918e36bca3dc99ba0ee0c22a607064ff4ddfb3a653e1a41ada5",
    jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-unified-source-range-f28e1fe874c1-8vcpu:1",
    jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-prepare-production",
  };
  const oldPrevious = {
    releaseId: "unified-f28e1fe874c1-r4",
    workerSourceGitSha: oldCurrent.workerSourceGitSha,
    imageUri: oldCurrent.imageUri,
    jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-unified-template-subtitles-f28e1fe874c1-4vcpu:4",
    jobQueueArn: oldCurrent.jobQueueArn,
  };
  const v4Current = {
    releaseId: "unified-template-subtitles-e0e89d5de448-v4",
    workerSourceGitSha: "e0e89d5de448be8c4da4def678c021987c92e7ed",
    imageUri: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:50aa6ba66d3e19f5eca617df614415e891e76c87bbb750ff6cb4a4b8a6a88ea9",
    jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-unified-template-subtitles-e0e89d5de448:1",
    jobQueueArn: oldCurrent.jobQueueArn,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: "b9f530954066e89e95fcd2cfb77db558e68530329d3d1d9db17e4e73c859d486",
  };
  const v4Next = {
    releaseId: "unified-template-subtitles-4e19c114f79e-v4",
    workerSourceGitSha: "4e19c114f79e74a73a4798f3fd898fa412967cc2",
    imageUri: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:99c0e66f66a78d8b60455075229271e161d77c7051c522d5a4d0ddd27f30a922",
    jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-unified-template-subtitles-4e19c114f79e:1",
    jobQueueArn: oldCurrent.jobQueueArn,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: "b9f530954066e89e95fcd2cfb77db558e68530329d3d1d9db17e4e73c859d486",
  };
  const approvedStates = [
    { schedulingMode: "fifo", current: oldCurrent, previous: oldPrevious },
    { schedulingMode: "fifo", current: v4Current, previous: oldCurrent },
    { schedulingMode: "fifo", current: v4Next, previous: v4Current },
    // Finalized AWS probe 98ac46d5-66bd-43d5-af3f-596776fc864e:
    // same v4/font/queue contract, with the current release retained as itself.
    { schedulingMode: "fifo", current: {
      ...v4Next,
      releaseId: "unified-template-subtitles-f32f42ae4467-v4",
      workerSourceGitSha: "f32f42ae44679eee6dcd084364cb6e31c1bc8a99",
      imageUri: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:b46b2974d0710d8b5b4cd1161f805cd9dd1bfd229dfea34fbd6cf4c91e4132fd",
      jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-unified-template-subtitles-f32f42ae4467:1",
    }, previous: v4Next },
  ];
  assert.ok(
    approvedStates.some((approved) => (
      JSON.stringify(approved) === JSON.stringify(unified)
    )),
    "unified target must match an exact reviewed pre/post-rotation state",
  );
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

test("fingerprints only the exact five current web admission identities", () => {
  const original = productionProjectTargetsFingerprint(registry);
  assert.match(original, /^[0-9a-f]{64}$/);
  const previousOnly = structuredClone(registry);
  previousOnly.lanes.unified_template_subtitles.previous.releaseId =
    "unified-template-subtitles-previous-copy";
  assert.equal(productionProjectTargetsFingerprint(previousOnly), original);
  const currentChanged = structuredClone(registry);
  currentChanged.lanes.unified_template_subtitles.current.releaseId =
    "unified-template-subtitles-next-r1";
  currentChanged.lanes.unified_template_subtitles.previous.submitAsReleaseId =
    "unified-template-subtitles-next-r1";
  assert.notEqual(productionProjectTargetsFingerprint(currentChanged), original);
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
              .jobDefinitionArn.replace(/:[1-9][0-9]*$/, ""),
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
