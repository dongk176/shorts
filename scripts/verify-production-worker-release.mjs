#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  productionWorkerEnvironment,
  readProductionWorkerRelease,
} from "./production-worker-release.mjs";
import {
  PROJECT_TARGET_PREFIXES,
  projectBatchTargets,
  validateActiveBatchResources,
} from "./verify-project-batch-targets.mjs";
import {
  PROJECT_TARGET_LANES,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";

const IMMUTABLE_ECR_IMAGE = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;
const ECR_IMAGE_PARTS = /^([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9][a-z0-9._/-]*)@(sha256:[0-9a-f]{64})$/;

export function validateWorkerAttemptBudget(ingestionSource, pipelineSource, expected = 20) {
  assert.match(
    ingestionSource,
    new RegExp(`^MAX_ACQUISITION_ATTEMPTS = ${expected}$`, "m"),
    `Worker 수집 시도 예산이 ${expected}이 아닙니다.`,
  );
  assert.match(
    pipelineSource,
    new RegExp(`^\\s*MAX_INLINE_INGESTION_ROUTES = ${expected}$`, "m"),
    `Worker inline route 예산이 ${expected}이 아닙니다.`,
  );
}

export function validateReleasedDefinitions(
  release,
  registry,
  targets,
  definitionRows,
  queueRows,
) {
  validateActiveBatchResources(
    targets,
    definitionRows,
    queueRows,
    PROJECT_TARGET_PREFIXES,
  );
  const byArn = new Map(definitionRows.map((row) => [row.jobDefinitionArn, row]));
  const currentByPrefix = Object.fromEntries(
    Object.entries(PROJECT_TARGET_LANES).map(([laneName, prefix]) => [
      prefix,
      registry.lanes[laneName].current,
    ]),
  );
  const failures = [];
  for (const [prefix, target] of Object.entries(targets)) {
    const row = byArn.get(target.definition);
    const image = String(row?.containerProperties?.image || "");
    const registered = currentByPrefix[prefix];
    if (!registered || image !== registered.imageUri) {
      failures.push(`${prefix} image digest 불일치`);
    } else if (!IMMUTABLE_ECR_IMAGE.test(image)) {
      failures.push(`${prefix} image가 immutable digest가 아님`);
    }
    if (Number(row?.retryStrategy?.attempts) !== release.batchRetryAttempts) {
      failures.push(`${prefix} Batch retry attempts 불일치`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

export function validatePreviousDefinitions(release, previousTargets, definitionRows) {
  const byArn = new Map(definitionRows.map((row) => [row.jobDefinitionArn, row]));
  const failures = [];
  for (const target of previousTargets) {
    const row = byArn.get(target.jobDefinitionArn);
    const image = String(row?.containerProperties?.image || "");
    if (image !== target.imageUri || !IMMUTABLE_ECR_IMAGE.test(image)) {
      failures.push(
        `${target.releaseId} image가 registry의 immutable digest와 다름`,
      );
    }
    if (Number(row?.retryStrategy?.attempts) !== release.batchRetryAttempts) {
      failures.push(`${target.releaseId} Batch retry attempts 불일치`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

export function validateRegistryQueueScheduling(registry, queueRows) {
  const byArn = new Map(queueRows.map((row) => [row.jobQueueArn, row]));
  const failures = [];
  for (const [laneName, lane] of Object.entries(registry.lanes)) {
    for (const target of [lane.current, lane.previous].filter(Boolean)) {
      const row = byArn.get(target.jobQueueArn);
      const hasFairSharePolicy = Boolean(String(row?.schedulingPolicyArn || "").trim());
      if (lane.schedulingMode === "fair_share" && !hasFairSharePolicy) {
        failures.push(`${laneName} queue에 fair-share policy가 없음`);
      }
      if (lane.schedulingMode === "fifo" && hasFairSharePolicy) {
        failures.push(`${laneName} FIFO queue에 scheduling policy가 있음`);
      }
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

export function validateLambdaRegistryConfiguration(environment) {
  if (environment.PROJECT_TARGET_REGISTRY_REQUIRED !== "true") {
    throw new Error("운영 Batch Submitter가 registry fail-closed 모드가 아닙니다.");
  }
  if (
    environment.PROJECT_TARGET_REGISTRY_PATH
    !== "/var/task/production-project-targets.json"
  ) {
    throw new Error("운영 Batch Submitter registry asset 경로가 올바르지 않습니다.");
  }
  if (environment.PROJECT_TARGET_REGISTRY_JSON) {
    throw new Error("운영 Batch Submitter에 중복 registry JSON 환경변수가 있습니다.");
  }
  return environment;
}

export function validateRegistryAsset(source, registry) {
  const deployed = JSON.parse(source);
  if (JSON.stringify(deployed) !== JSON.stringify(registry)) {
    throw new Error("운영 Batch Submitter asset registry가 커밋된 registry와 다릅니다.");
  }
}

export function registryEcrImageRequirements(registry) {
  const repositories = new Map();
  for (const lane of Object.values(registry.lanes || {})) {
    for (const target of [lane?.current, lane?.previous].filter(Boolean)) {
      const match = ECR_IMAGE_PARTS.exec(String(target.imageUri || ""));
      if (!match) {
        throw new Error(`${target.releaseId || "unknown"} registry image URI가 올바르지 않습니다.`);
      }
      const [, accountId, region, repositoryName, imageDigest] = match;
      const key = `${accountId}:${region}:${repositoryName}`;
      const requirement = repositories.get(key) || {
        accountId,
        region,
        repositoryName,
        imageDigests: new Set(),
      };
      requirement.imageDigests.add(imageDigest);
      repositories.set(key, requirement);
    }
  }
  return [...repositories.values()].map((requirement) => ({
    ...requirement,
    imageDigests: [...requirement.imageDigests].sort(),
  }));
}

export function validateRegistryEcrImages(
  requirements,
  responses,
  expectedRegion,
) {
  const failures = [];
  for (const requirement of requirements) {
    if (requirement.region !== expectedRegion) {
      failures.push(
        `${requirement.repositoryName} registry region ${requirement.region} 불일치`,
      );
      continue;
    }
    const key = `${requirement.accountId}:${requirement.region}:${requirement.repositoryName}`;
    const response = responses[key];
    const found = new Set(
      (response?.images || []).map((image) => String(image?.imageId?.imageDigest || "")),
    );
    for (const imageDigest of requirement.imageDigests) {
      if (!found.has(imageDigest)) {
        failures.push(`${requirement.repositoryName}@${imageDigest}가 ECR에 없습니다.`);
      }
    }
    if ((response?.failures || []).length > 0) {
      failures.push(`${requirement.repositoryName} ECR 조회가 일부 실패했습니다.`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

function verifyRegistryEcrImages(registry, region) {
  const requirements = registryEcrImageRequirements(registry);
  const responses = {};
  for (const requirement of requirements) {
    const key = `${requirement.accountId}:${requirement.region}:${requirement.repositoryName}`;
    responses[key] = awsJson([
      "ecr", "batch-get-image",
      "--region", region,
      "--registry-id", requirement.accountId,
      "--repository-name", requirement.repositoryName,
      "--image-ids",
      ...requirement.imageDigests.map((digest) => `imageDigest=${digest}`),
    ]);
  }
  validateRegistryEcrImages(requirements, responses, region);
}

export function readReleasedWorkerSources(
  root,
  workerSourceGitSha,
  runGit = execFileSync,
) {
  if (!/^[0-9a-f]{40}$/.test(String(workerSourceGitSha || ""))) {
    throw new Error("운영 Worker source Git SHA 형식이 올바르지 않습니다.");
  }
  runGit("git", ["cat-file", "-e", `${workerSourceGitSha}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  const readAtRelease = (filePath) => runGit(
    "git",
    ["show", `${workerSourceGitSha}:${filePath}`],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return {
    ingestionSource: readAtRelease("worker/shorts_worker/ingestion.py"),
    pipelineSource: readAtRelease("worker/shorts_worker/worker_pipeline.py"),
  };
}

function awsJson(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }));
}

export function parseArgs(argv) {
  const options = {
    release: "production-worker-release.json",
    lambdaFunction: "shorts-mvp-batch-submitter-production",
    region: "ap-northeast-2",
    resourcesOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release") options.release = argv[++index] || "";
    else if (argv[index] === "--lambda-function") options.lambdaFunction = argv[++index] || "";
    else if (argv[index] === "--region") options.region = argv[++index] || "";
    else if (argv[index] === "--resources-only") options.resourcesOnly = true;
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  return options;
}

export function runProductionWorkerVerification(argv = process.argv.slice(2)) {
  const root = path.resolve(import.meta.dirname, "..");
  const options = parseArgs(argv);
  const release = readProductionWorkerRelease(path.resolve(root, options.release));
  const registry = readProductionProjectTargets(
    path.resolve(root, "production-project-targets.json"),
  );
  const releaseEnvironment = productionWorkerEnvironment(release);
  const targets = projectBatchTargets(
    releaseEnvironment,
    PROJECT_TARGET_PREFIXES,
  );
  if (!options.resourcesOnly) {
    const lambdaEnvironment = awsJson([
      "lambda", "get-function-configuration",
      "--function-name", options.lambdaFunction,
      "--region", options.region,
      "--query", "Environment.Variables",
    ]);
    validateLambdaRegistryConfiguration(lambdaEnvironment);
    const lambdaDetails = awsJson([
      "lambda", "get-function",
      "--function-name", options.lambdaFunction,
      "--region", options.region,
    ]);
    const location = String(lambdaDetails?.Code?.Location || "");
    if (!location.startsWith("https://")) {
      throw new Error("운영 Batch Submitter 배포 asset URL을 확인할 수 없습니다.");
    }
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-lambda-registry-"));
    try {
      const archive = path.join(tempDirectory, "function.zip");
      execFileSync("curl", [
        "--fail", "--silent", "--show-error", "--location",
        location, "--output", archive,
      ], { stdio: ["ignore", "ignore", "inherit"] });
      const registrySource = execFileSync("unzip", [
        "-p", archive, "production-project-targets.json",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      validateRegistryAsset(registrySource, registry);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }
  const previousTargets = Object.values(registry.lanes)
    .map((lane) => lane.previous)
    .filter(Boolean);
  const definitions = [...new Set([
    ...Object.values(targets).map(({ definition }) => definition),
    ...previousTargets.map((target) => target.jobDefinitionArn),
  ])];
  const queues = [...new Set([
    ...Object.values(targets).map(({ queue }) => queue),
    ...previousTargets.map((target) => target.jobQueueArn),
  ])];
  const definitionRows = awsJson([
    "batch", "describe-job-definitions",
    "--region", options.region,
    "--status", "ACTIVE",
    "--job-definitions", ...definitions,
  ]).jobDefinitions || [];
  const queueRows = awsJson([
    "batch", "describe-job-queues",
    "--region", options.region,
    "--job-queues", ...queues,
  ]).jobQueues || [];
  validateReleasedDefinitions(
    release,
    registry,
    projectBatchTargets(releaseEnvironment, PROJECT_TARGET_PREFIXES),
    definitionRows,
    queueRows,
  );
  validatePreviousDefinitions(release, previousTargets, definitionRows);
  validateRegistryQueueScheduling(registry, queueRows);
  const activeDefinitionArns = new Set(
    definitionRows.filter((row) => row.status === "ACTIVE")
      .map((row) => row.jobDefinitionArn),
  );
  const activeQueueArns = new Set(
    queueRows.filter((row) => row.status === "VALID" && row.state === "ENABLED")
      .map((row) => row.jobQueueArn),
  );
  for (const target of previousTargets) {
    if (!activeDefinitionArns.has(target.jobDefinitionArn)) {
      throw new Error(`previous Job Definition이 ACTIVE가 아닙니다: ${target.releaseId}`);
    }
    if (!activeQueueArns.has(target.jobQueueArn)) {
      throw new Error(`previous queue가 VALID/ENABLED가 아닙니다: ${target.releaseId}`);
    }
  }

  const repositoryName = release.imageUri
    .slice(release.imageUri.indexOf("/") + 1, release.imageUri.indexOf("@"));
  const releaseImage = ECR_IMAGE_PARTS.exec(release.imageUri);
  if (!releaseImage) {
    throw new Error("운영 Worker ECR image URI를 해석할 수 없습니다.");
  }
  const repositories = awsJson([
    "ecr", "describe-repositories",
    "--region", options.region,
    "--registry-id", releaseImage[1],
    "--repository-names", repositoryName,
  ]).repositories || [];
  if (repositories[0]?.imageTagMutability !== "IMMUTABLE") {
    throw new Error("운영 Worker ECR 저장소가 IMMUTABLE이 아닙니다.");
  }
  verifyRegistryEcrImages(registry, options.region);

  const releaseSourceShas = new Set(
    Object.values(registry.lanes).flatMap((lane) => (
      [lane.current, lane.previous]
        .filter(Boolean)
        .map((target) => target.workerSourceGitSha)
    )),
  );
  for (const workerSourceGitSha of releaseSourceShas) {
    const releasedSources = readReleasedWorkerSources(root, workerSourceGitSha);
    validateWorkerAttemptBudget(
      releasedSources.ingestionSource,
      releasedSources.pipelineSource,
      release.ingestionAttemptBudget,
    );
  }
  process.stdout.write([
    options.resourcesOnly
      ? "운영 Worker 리소스/provenance 검증 통과"
      : "운영 Worker 고정 검증 통과",
    `source: ${release.workerSourceGitSha}`,
    `image: ${release.imageUri}`,
    options.resourcesOnly
      ? "targets: 5/5 ACTIVE, queues/scheduling 일치, immutable images, Batch retry=1, released source 검증"
      : "targets: 5/5 ACTIVE, Lambda registry 일치, Batch retry=1, ingestion budget=20",
    "",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runProductionWorkerVerification();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
