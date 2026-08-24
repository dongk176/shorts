#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  productionWorkerCdkContext,
  readProductionWorkerRelease,
} from "./production-worker-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const infraDirectory = path.join(root, "infra", "aws");
const release = readProductionWorkerRelease(
  path.join(root, "production-worker-release.json"),
);
const batchIdentity = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):/.exec(
  release.targets.legacyProject.jobDefinitionArn,
);
if (!batchIdentity) {
  throw new Error("운영 Worker manifest에서 Batch 계정/리전을 확인할 수 없습니다.");
}
const batchArnPrefix = `arn:aws:batch:${batchIdentity[1]}:${batchIdentity[2]}`;
const unifiedTemplateSynthesisContext = {
  // The committed stable manifest intentionally remains a four-target record.
  // CDK still needs a distinct, revision-pinned fifth target to exercise the
  // production fail-closed contract during a local synth.
  unifiedTemplateSubtitlesJobDefinitionArn:
    `${batchArnPrefix}:job-definition/unified-template-subtitles-local-synth:1`,
  unifiedTemplateSubtitlesBatchQueueArn:
    `${batchArnPrefix}:job-queue/shorts-mvp-prepare-production`,
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: infraDirectory,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "build"]);
run("npx", [
  "cdk",
  "synth",
  "--quiet",
  "-c",
  "environment=production",
  "-c",
  "workerImageTag=local-synth",
  "-c",
  "legacyRerenderImageTag=legacy-local-synth",
  ...Object.entries(productionWorkerCdkContext(release)).flatMap(([name, value]) => [
    "-c",
    `${name}=${value}`,
  ]),
  ...Object.entries(unifiedTemplateSynthesisContext).flatMap(([name, value]) => [
    "-c",
    `${name}=${value}`,
  ]),
]);
