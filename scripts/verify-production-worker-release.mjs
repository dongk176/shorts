#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  productionWorkerEnvironment,
  readProductionWorkerRelease,
} from "./production-worker-release.mjs";
import {
  compareProjectBatchTargets,
  projectBatchTargets,
  validateActiveBatchResources,
} from "./verify-project-batch-targets.mjs";

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

export function validateReleasedDefinitions(release, targets, definitionRows, queueRows) {
  validateActiveBatchResources(targets, definitionRows, queueRows);
  const byArn = new Map(definitionRows.map((row) => [row.jobDefinitionArn, row]));
  const failures = [];
  for (const [prefix, target] of Object.entries(targets)) {
    const row = byArn.get(target.definition);
    if (row?.containerProperties?.image !== release.imageUri) {
      failures.push(`${prefix} image digest 불일치`);
    }
    if (Number(row?.retryStrategy?.attempts) !== release.batchRetryAttempts) {
      failures.push(`${prefix} Batch retry attempts 불일치`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

function awsJson(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }));
}

function parseArgs(argv) {
  const options = {
    release: "production-worker-release.json",
    lambdaFunction: "shorts-mvp-batch-submitter-production",
    region: "ap-northeast-2",
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release") options.release = argv[++index] || "";
    else if (argv[index] === "--lambda-function") options.lambdaFunction = argv[++index] || "";
    else if (argv[index] === "--region") options.region = argv[++index] || "";
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  return options;
}

export function runProductionWorkerVerification(argv = process.argv.slice(2)) {
  const root = path.resolve(import.meta.dirname, "..");
  const options = parseArgs(argv);
  const release = readProductionWorkerRelease(path.resolve(root, options.release));
  const releaseEnvironment = productionWorkerEnvironment(release);
  const lambdaEnvironment = awsJson([
    "lambda", "get-function-configuration",
    "--function-name", options.lambdaFunction,
    "--region", options.region,
    "--query", "Environment.Variables",
  ]);
  const targets = compareProjectBatchTargets(releaseEnvironment, lambdaEnvironment);
  const definitions = Object.values(targets).map(({ definition }) => definition);
  const queues = [...new Set(Object.values(targets).map(({ queue }) => queue))];
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
  validateReleasedDefinitions(release, projectBatchTargets(releaseEnvironment), definitionRows, queueRows);

  const repositoryName = release.imageUri
    .slice(release.imageUri.indexOf("/") + 1, release.imageUri.indexOf("@"));
  const repositories = awsJson([
    "ecr", "describe-repositories",
    "--region", options.region,
    "--repository-names", repositoryName,
  ]).repositories || [];
  if (repositories[0]?.imageTagMutability !== "IMMUTABLE") {
    throw new Error("운영 Worker ECR 저장소가 IMMUTABLE이 아닙니다.");
  }

  execFileSync("git", ["cat-file", "-e", `${release.workerSourceGitSha}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["diff", "--quiet", release.workerSourceGitSha, "--", "worker"], {
    cwd: root,
    stdio: "ignore",
  });
  validateWorkerAttemptBudget(
    fs.readFileSync(path.join(root, "worker/shorts_worker/ingestion.py"), "utf8"),
    fs.readFileSync(path.join(root, "worker/shorts_worker/worker_pipeline.py"), "utf8"),
    release.ingestionAttemptBudget,
  );
  process.stdout.write([
    "운영 Worker 고정 검증 통과",
    `source: ${release.workerSourceGitSha}`,
    `image: ${release.imageUri}`,
    "targets: 4/4 ACTIVE, Lambda 일치, Batch retry=1, ingestion budget=20",
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
