#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_TARGET_LANES = {
  legacy_project: "LEGACY_PROJECT",
  source_range: "SOURCE_RANGE",
  elevenlabs_transcription: "ELEVENLABS_TRANSCRIPTION",
  subtitle_templates: "SUBTITLE_TEMPLATES",
  unified_template_subtitles: "UNIFIED_TEMPLATE_SUBTITLES",
};

const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_URI = /^([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;
const JOB_DEFINITION_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-definition\/[A-Za-z0-9_-]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-queue\/[A-Za-z0-9_-]+$/;
const EXACT_ROOT_KEYS = ["environment", "lanes", "version"];
const EXACT_LANE_KEYS = ["current", "previous", "schedulingMode"];
const EXACT_CURRENT_KEYS = [
  "imageUri",
  "jobDefinitionArn",
  "jobQueueArn",
  "releaseId",
  "workerSourceGitSha",
];
const EXACT_PREVIOUS_KEYS = [...EXACT_CURRENT_KEYS];

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} 키가 정확하지 않습니다: ${actual.join(", ")}`);
  }
}

function validateReleaseTarget(target, label, expectedKeys) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(`${label} 대상이 JSON 객체가 아닙니다.`);
  }
  requireExactKeys(target, expectedKeys, label);
  if (!RELEASE_ID.test(String(target.releaseId || ""))) {
    throw new Error(`${label}.releaseId 형식이 올바르지 않습니다.`);
  }
  if (!GIT_SHA.test(String(target.workerSourceGitSha || ""))) {
    throw new Error(`${label}.workerSourceGitSha 형식이 올바르지 않습니다.`);
  }
  const image = IMAGE_URI.exec(String(target.imageUri || ""));
  const definition = JOB_DEFINITION_ARN.exec(String(target.jobDefinitionArn || ""));
  const queue = JOB_QUEUE_ARN.exec(String(target.jobQueueArn || ""));
  if (!image || !definition || !queue) {
    throw new Error(`${label} Batch 대상 ARN이 정확하지 않습니다.`);
  }
  if (definition[1] !== queue[1] || definition[2] !== queue[2]) {
    throw new Error(`${label} Job Definition과 queue의 계정/리전이 다릅니다.`);
  }
  if (image[1] !== definition[2] || image[2] !== definition[1]) {
    throw new Error(`${label} Worker image와 Batch 대상의 계정/리전이 다릅니다.`);
  }
  if (!String(target.jobDefinitionArn).includes(target.workerSourceGitSha.slice(0, 7))) {
    throw new Error(`${label} Job Definition에 Worker source 식별자가 없습니다.`);
  }
  return `${definition[1]}:${definition[2]}`;
}

export function validateProductionProjectTargets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("운영 프로젝트 대상 registry가 JSON 객체가 아닙니다.");
  }
  requireExactKeys(value, EXACT_ROOT_KEYS, "registry");
  if (value.version !== 1 || value.environment !== "production") {
    throw new Error("운영 프로젝트 대상 registry 버전 또는 환경이 올바르지 않습니다.");
  }
  if (!value.lanes || typeof value.lanes !== "object" || Array.isArray(value.lanes)) {
    throw new Error("registry.lanes가 JSON 객체가 아닙니다.");
  }
  requireExactKeys(value.lanes, Object.keys(PROJECT_TARGET_LANES), "registry.lanes");

  const identities = new Set();
  const definitions = new Set();
  const releaseIds = new Set();
  const queueSchedulingModes = new Map();
  for (const laneName of Object.keys(PROJECT_TARGET_LANES)) {
    const lane = value.lanes[laneName];
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) {
      throw new Error(`${laneName} lane이 JSON 객체가 아닙니다.`);
    }
    requireExactKeys(lane, EXACT_LANE_KEYS, laneName);
    if (!["fair_share", "fifo"].includes(lane.schedulingMode)) {
      throw new Error(`${laneName}.schedulingMode 값이 올바르지 않습니다.`);
    }
    identities.add(validateReleaseTarget(
      lane.current,
      `${laneName}.current`,
      EXACT_CURRENT_KEYS,
    ));
    if (definitions.has(lane.current.jobDefinitionArn)) {
      throw new Error("현재 Job Definition은 lane마다 격리되어야 합니다.");
    }
    if (releaseIds.has(lane.current.releaseId)) {
      throw new Error("releaseId는 registry 안에서 고유해야 합니다.");
    }
    definitions.add(lane.current.jobDefinitionArn);
    releaseIds.add(lane.current.releaseId);
    const currentQueueMode = queueSchedulingModes.get(lane.current.jobQueueArn);
    if (currentQueueMode && currentQueueMode !== lane.schedulingMode) {
      throw new Error("같은 Batch queue를 상충하는 schedulingMode로 사용할 수 없습니다.");
    }
    queueSchedulingModes.set(lane.current.jobQueueArn, lane.schedulingMode);

    if (lane.previous !== null) {
      const previousKeys = lane.previous.submitAsReleaseId === undefined
        ? EXACT_PREVIOUS_KEYS
        : [...EXACT_PREVIOUS_KEYS, "submitAsReleaseId"];
      identities.add(validateReleaseTarget(
        lane.previous,
        `${laneName}.previous`,
        previousKeys,
      ));
      if (lane.previous.releaseId === lane.current.releaseId) {
        throw new Error(`${laneName}.previous release는 current와 달라야 합니다.`);
      }
      if (
        lane.previous.submitAsReleaseId !== undefined
        && ![
          lane.current.releaseId,
          lane.previous.releaseId,
        ].includes(lane.previous.submitAsReleaseId)
      ) {
        throw new Error(
          `${laneName}.previous submitAsReleaseId는 같은 lane release만 가리킬 수 있습니다.`,
        );
      }
      if (definitions.has(lane.previous.jobDefinitionArn)) {
        throw new Error("previous Job Definition은 다른 release와 겹칠 수 없습니다.");
      }
      if (releaseIds.has(lane.previous.releaseId)) {
        throw new Error("releaseId는 registry 안에서 고유해야 합니다.");
      }
      definitions.add(lane.previous.jobDefinitionArn);
      releaseIds.add(lane.previous.releaseId);
      const previousQueueMode = queueSchedulingModes.get(lane.previous.jobQueueArn);
      if (previousQueueMode && previousQueueMode !== lane.schedulingMode) {
        throw new Error("같은 Batch queue를 상충하는 schedulingMode로 사용할 수 없습니다.");
      }
      queueSchedulingModes.set(lane.previous.jobQueueArn, lane.schedulingMode);
    }
  }
  if (identities.size !== 1) {
    throw new Error("registry의 모든 Batch 대상은 같은 AWS 계정/리전을 사용해야 합니다.");
  }
  return value;
}

export function validateLiveProductionProjectTargetTransition(
  liveEnvironment,
  candidateValue,
) {
  if (
    !liveEnvironment
    || typeof liveEnvironment !== "object"
    || Array.isArray(liveEnvironment)
  ) {
    throw new Error("운영 Batch Submitter 환경변수를 확인할 수 없습니다.");
  }
  const candidate = validateProductionProjectTargets(candidateValue);
  const retained = {};
  for (const [laneName, prefix] of Object.entries(PROJECT_TARGET_LANES)) {
    const definition = String(
      liveEnvironment[`${prefix}_JOB_DEFINITION_ARN`] || "",
    ).trim();
    const queue = String(
      liveEnvironment[`${prefix}_BATCH_QUEUE_ARN`] || "",
    ).trim();
    if (!definition || !queue) {
      throw new Error(
        `운영 ${laneName} admission target ARN 쌍을 확인할 수 없습니다.`,
      );
    }
    const lane = candidate.lanes[laneName];
    const release = [
      lane.current,
      lane.previous,
    ].filter(Boolean).find((target) => (
      target.jobDefinitionArn === definition
      && target.jobQueueArn === queue
    ));
    if (!release) {
      throw new Error(
        `운영 ${laneName} admission target이 후보 current/previous에 보존되지 않았습니다.`,
      );
    }
    if (
      lane.previous
      && release.releaseId === lane.previous.releaseId
      && (release.submitAsReleaseId || release.releaseId) !== release.releaseId
    ) {
      throw new Error(
        `운영 ${laneName} admission target을 후보 previous로 보존하려면 submitAsReleaseId가 자기 자신이어야 합니다.`,
      );
    }
    retained[laneName] = release.releaseId;
  }
  return retained;
}

export function readProductionProjectTargets(
  filePath = path.resolve(import.meta.dirname, "..", "production-project-targets.json"),
) {
  return validateProductionProjectTargets(
    JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")),
  );
}

export function productionProjectTargetEnvironment(registry) {
  const validated = validateProductionProjectTargets(registry);
  const values = {
    PROJECT_TARGET_REGISTRY_JSON: JSON.stringify(validated),
  };
  for (const [laneName, prefix] of Object.entries(PROJECT_TARGET_LANES)) {
    const lane = validated.lanes[laneName];
    values[`${prefix}_JOB_DEFINITION_ARN`] = lane.current.jobDefinitionArn;
    values[`${prefix}_BATCH_QUEUE_ARN`] = lane.current.jobQueueArn;
    values[`${prefix}_BATCH_TARGET_RELEASE_ID`] = lane.current.releaseId;
    if (lane.previous) {
      values[`${prefix}_PREVIOUS_JOB_DEFINITION_ARN`] =
        lane.previous.jobDefinitionArn;
      values[`${prefix}_PREVIOUS_BATCH_QUEUE_ARN`] = lane.previous.jobQueueArn;
      values[`${prefix}_PREVIOUS_BATCH_TARGET_RELEASE_ID`] =
        lane.previous.releaseId;
      if (lane.previous.submitAsReleaseId) {
        values[`${prefix}_PREVIOUS_SUBMIT_AS_RELEASE_ID`] =
          lane.previous.submitAsReleaseId;
      }
    }
  }
  return values;
}

export function productionProjectTargetCdkContext(registry) {
  return {
    projectTargetRegistryJson: JSON.stringify(
      validateProductionProjectTargets(registry),
    ),
  };
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || "check";
  const registry = readProductionProjectTargets(argv[1]);
  if (command === "check") {
    process.stdout.write(
      `운영 프로젝트 대상 registry 확인 완료: ${Object.keys(registry.lanes).length}개 lane\n`,
    );
    return;
  }
  if (command === "env") {
    for (const [name, value] of Object.entries(
      productionProjectTargetEnvironment(registry),
    )) {
      process.stdout.write(`${name}=${value}\n`);
    }
    return;
  }
  if (command === "context") {
    process.stdout.write(`${JSON.stringify(productionProjectTargetCdkContext(registry))}\n`);
    return;
  }
  throw new Error(`알 수 없는 명령입니다: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
