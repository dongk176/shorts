#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  productionProjectTargetCdkContext,
  productionProjectTargetEnvironment,
  readProductionProjectTargets,
  validateProductionProjectTargets,
} from "./production-project-targets.mjs";

export const RELEASE_TARGETS = {
  legacyProject: "LEGACY_PROJECT",
  sourceRange: "SOURCE_RANGE",
  elevenLabsTranscription: "ELEVENLABS_TRANSCRIPTION",
  subtitleTemplates: "SUBTITLE_TEMPLATES",
};

const RELEASE_TARGET_LANES = {
  legacyProject: "legacy_project",
  sourceRange: "source_range",
  elevenLabsTranscription: "elevenlabs_transcription",
  subtitleTemplates: "subtitle_templates",
};

const GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_URI = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;
const JOB_DEFINITION_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-definition\/[A-Za-z0-9_-]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-queue\/[A-Za-z0-9_-]+$/;

export function validateProductionWorkerRelease(
  value,
  projectTargets = readProductionProjectTargets(),
) {
  const registry = validateProductionProjectTargets(projectTargets);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("운영 Worker release manifest가 JSON 객체가 아닙니다.");
  }
  if (value.version !== 1 || value.environment !== "production") {
    throw new Error("운영 Worker release manifest 버전 또는 환경이 올바르지 않습니다.");
  }
  if (!GIT_SHA.test(String(value.workerSourceGitSha || ""))) {
    throw new Error("workerSourceGitSha가 정확한 Git SHA가 아닙니다.");
  }
  if (!IMAGE_DIGEST.test(String(value.imageDigest || ""))) {
    throw new Error("imageDigest가 정확한 sha256 digest가 아닙니다.");
  }
  if (
    !IMAGE_URI.test(String(value.imageUri || ""))
    || !String(value.imageUri).endsWith(`@${value.imageDigest}`)
  ) {
    throw new Error("imageUri가 고정 digest를 사용하지 않습니다.");
  }
  if (value.ingestionAttemptBudget !== 20) {
    throw new Error("운영 ingestion 시도 예산은 정확히 20이어야 합니다.");
  }
  if (value.batchRetryAttempts !== 1) {
    throw new Error("운영 AWS Batch 재시도 횟수는 정확히 1이어야 합니다.");
  }

  const definitions = new Set();
  const identities = new Set();
  for (const targetName of Object.keys(RELEASE_TARGETS)) {
    const target = value.targets?.[targetName];
    const definitionMatch = JOB_DEFINITION_ARN.exec(
      String(target?.jobDefinitionArn || ""),
    );
    const queueMatch = JOB_QUEUE_ARN.exec(String(target?.jobQueueArn || ""));
    if (!definitionMatch || !queueMatch) {
      throw new Error(`${targetName} Batch 대상 ARN이 올바르지 않습니다.`);
    }
    if (
      definitionMatch[1] !== queueMatch[1]
      || definitionMatch[2] !== queueMatch[2]
    ) {
      throw new Error(`${targetName} Job Definition과 queue의 계정/리전이 다릅니다.`);
    }
    if (definitions.has(target.jobDefinitionArn)) {
      throw new Error("운영 프로젝트별 Job Definition은 서로 달라야 합니다.");
    }
    definitions.add(target.jobDefinitionArn);
    identities.add(`${definitionMatch[1]}:${definitionMatch[2]}`);
  }
  if (identities.size !== 1) {
    throw new Error("운영 Worker 대상이 서로 다른 AWS 계정 또는 리전을 사용합니다.");
  }
  for (const [targetName, laneName] of Object.entries(RELEASE_TARGET_LANES)) {
    const target = value.targets[targetName];
    const registered = registry.lanes[laneName].current;
    if (
      target.jobDefinitionArn !== registered.jobDefinitionArn
      || target.jobQueueArn !== registered.jobQueueArn
    ) {
      throw new Error(
        `${targetName} Worker release 대상이 production-project-targets registry와 다릅니다.`,
      );
    }
    if (
      registered.workerSourceGitSha !== value.workerSourceGitSha
      || registered.imageUri !== value.imageUri
    ) {
      throw new Error(
        `${targetName} Worker provenance가 production-project-targets registry와 다릅니다.`,
      );
    }
  }
  return value;
}

export function readProductionWorkerRelease(filePath = "production-worker-release.json") {
  const absolutePath = path.resolve(filePath);
  return validateProductionWorkerRelease(
    JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  );
}

export function productionWorkerEnvironment(release) {
  const registry = readProductionProjectTargets();
  validateProductionWorkerRelease(release, registry);
  return productionProjectTargetEnvironment(registry);
}

export function productionWorkerCdkContext(release) {
  const registry = readProductionProjectTargets();
  validateProductionWorkerRelease(release, registry);
  return productionProjectTargetCdkContext(registry);
}

export function assertWorkerReleaseMatchesProjectTargets(
  release,
  registry = readProductionProjectTargets(),
) {
  return validateProductionWorkerRelease(
    release,
    validateProductionProjectTargets(registry),
  );
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || "check";
  const release = readProductionWorkerRelease(
    argv[1] || path.resolve(import.meta.dirname, "..", "production-worker-release.json"),
  );
  if (command === "check") {
    process.stdout.write(
      `운영 Worker release manifest 확인 완료: ${release.imageDigest}\n`,
    );
    return;
  }
  if (command === "env") {
    for (const [name, value] of Object.entries(productionWorkerEnvironment(release))) {
      process.stdout.write(`${name}=${value}\n`);
    }
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
