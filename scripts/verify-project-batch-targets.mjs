#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STABLE_PROJECT_TARGET_PREFIXES = [
  "LEGACY_PROJECT",
  "SOURCE_RANGE",
  "ELEVENLABS_TRANSCRIPTION",
  "SUBTITLE_TEMPLATES",
];
export const PROJECT_TARGET_PREFIXES = [
  ...STABLE_PROJECT_TARGET_PREFIXES,
  "UNIFIED_TEMPLATE_SUBTITLES",
];

const JOB_DEFINITION_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-definition\/[^:]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-queue\/[^/]+$/;

function decodeEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("환경변수 파일에 올바르지 않은 큰따옴표 값이 있습니다.");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = decodeEnvValue(match[2]);
  }
  return values;
}

function requiredTargetValue(environment, name, pattern) {
  const value = String(environment[name] ?? "").trim();
  if (!pattern.test(value)) {
    throw new Error(`${name} 값이 정확한 AWS ARN이 아닙니다.`);
  }
  return value;
}

export function projectBatchTargets(
  environment,
  prefixes = PROJECT_TARGET_PREFIXES,
) {
  const targets = {};
  const identities = new Set();
  const definitions = new Set();

  for (const prefix of prefixes) {
    const definitionName = `${prefix}_JOB_DEFINITION_ARN`;
    const queueName = `${prefix}_BATCH_QUEUE_ARN`;
    const definition = requiredTargetValue(
      environment,
      definitionName,
      JOB_DEFINITION_ARN,
    );
    const queue = requiredTargetValue(environment, queueName, JOB_QUEUE_ARN);
    const definitionIdentity = JOB_DEFINITION_ARN.exec(definition);
    const queueIdentity = JOB_QUEUE_ARN.exec(queue);
    if (
      definitionIdentity?.[1] !== queueIdentity?.[1]
      || definitionIdentity?.[2] !== queueIdentity?.[2]
    ) {
      throw new Error(`${prefix} Job Definition과 queue의 AWS 계정/리전이 다릅니다.`);
    }
    identities.add(`${definitionIdentity[1]}:${definitionIdentity[2]}`);
    if (definitions.has(definition)) {
      throw new Error(`${prefix} Job Definition이 다른 프로젝트 대상과 격리되지 않았습니다.`);
    }
    definitions.add(definition);
    targets[prefix] = { definition, queue };
  }

  if (identities.size !== 1) {
    throw new Error("프로젝트 Batch 대상들이 서로 다른 AWS 계정 또는 리전을 가리킵니다.");
  }
  return targets;
}

export function compareProjectBatchTargets(
  webEnvironment,
  lambdaEnvironment,
  prefixes = PROJECT_TARGET_PREFIXES,
) {
  const webTargets = projectBatchTargets(webEnvironment, prefixes);
  const lambdaTargets = projectBatchTargets(lambdaEnvironment, prefixes);
  const mismatches = [];

  for (const prefix of prefixes) {
    if (webTargets[prefix].definition !== lambdaTargets[prefix].definition) {
      mismatches.push(`${prefix}_JOB_DEFINITION_ARN`);
    }
    if (webTargets[prefix].queue !== lambdaTargets[prefix].queue) {
      mismatches.push(`${prefix}_BATCH_QUEUE_ARN`);
    }
  }

  if (mismatches.length) {
    throw new Error([
      "웹과 Batch 제출 Lambda의 신뢰 대상이 달라 배포를 중단합니다.",
      ...mismatches.map((name) => `- ${name}`),
    ].join("\n"));
  }
  return webTargets;
}

export function validateActiveBatchResources(
  targets,
  definitionRows,
  queueRows,
  prefixes = PROJECT_TARGET_PREFIXES,
) {
  const activeDefinitions = new Set(
    definitionRows
      .filter((row) => row?.status === "ACTIVE")
      .map((row) => row.jobDefinitionArn),
  );
  const enabledQueues = new Set(
    queueRows
      .filter((row) => row?.status === "VALID" && row?.state === "ENABLED")
      .map((row) => row.jobQueueArn),
  );
  const failures = [];
  for (const prefix of prefixes) {
    if (!activeDefinitions.has(targets[prefix].definition)) {
      failures.push(`${prefix}_JOB_DEFINITION_ARN is not ACTIVE`);
    }
    if (!enabledQueues.has(targets[prefix].queue)) {
      failures.push(`${prefix}_BATCH_QUEUE_ARN is not VALID/ENABLED`);
    }
  }
  if (failures.length) {
    throw new Error([
      "웹이 사용할 AWS Batch 대상이 제출 가능한 상태가 아니어서 배포를 중단합니다.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"));
  }
}

function parseArgs(argv) {
  const options = {
    envFile: ".env.local",
    functionName: process.env.BATCH_SUBMITTER_FUNCTION_NAME?.trim() || "",
    region: process.env.AWS_REGION?.trim() || "ap-northeast-2",
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--env") options.envFile = argv[++index] || "";
    else if (argv[index] === "--lambda-function") {
      options.functionName = argv[++index] || "";
    } else if (argv[index] === "--region") options.region = argv[++index] || "";
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  if (!options.envFile) throw new Error("--env <환경변수 파일>이 필요합니다.");
  if (!options.functionName) {
    throw new Error("--lambda-function <Batch 제출 Lambda 이름>이 필요합니다.");
  }
  if (!/^[a-z0-9-]+$/.test(options.region)) {
    throw new Error("AWS 리전 형식이 올바르지 않습니다.");
  }
  return options;
}

function readLambdaTargets(functionName, region) {
  const names = PROJECT_TARGET_PREFIXES.flatMap((prefix) => [
    `${prefix}_JOB_DEFINITION_ARN`,
    `${prefix}_BATCH_QUEUE_ARN`,
  ]);
  const projection = names.map((name) => `${name}:${name}`).join(",");
  const output = execFileSync("aws", [
    "lambda",
    "get-function-configuration",
    "--function-name",
    functionName,
    "--region",
    region,
    "--query",
    `Environment.Variables.{${projection}}`,
    "--output",
    "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(output);
}

function readActiveBatchResources(targets, region) {
  const definitions = PROJECT_TARGET_PREFIXES.map(
    (prefix) => targets[prefix].definition,
  );
  const queues = [...new Set(PROJECT_TARGET_PREFIXES.map(
    (prefix) => targets[prefix].queue,
  ))];
  const definitionResponse = JSON.parse(execFileSync("aws", [
    "batch",
    "describe-job-definitions",
    "--region",
    region,
    "--job-definitions",
    ...definitions,
    "--status",
    "ACTIVE",
    "--output",
    "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  const queueResponse = JSON.parse(execFileSync("aws", [
    "batch",
    "describe-job-queues",
    "--region",
    region,
    "--job-queues",
    ...queues,
    "--output",
    "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  validateActiveBatchResources(
    targets,
    definitionResponse.jobDefinitions ?? [],
    queueResponse.jobQueues ?? [],
  );
}

export function runProjectBatchTargetVerification(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const webEnvironment = parseEnvFile(
    readFileSync(resolve(options.envFile), "utf8"),
  );
  const lambdaEnvironment = readLambdaTargets(options.functionName, options.region);
  const targets = compareProjectBatchTargets(webEnvironment, lambdaEnvironment);
  readActiveBatchResources(targets, options.region);
  process.stdout.write(
    `Batch 대상 사전검증 통과: ${PROJECT_TARGET_PREFIXES.length}개 대상이 Lambda 신뢰값과 일치하고 ACTIVE 상태입니다.\n`,
  );
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    runProjectBatchTargetVerification();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
