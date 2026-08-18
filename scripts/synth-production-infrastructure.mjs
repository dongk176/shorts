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
]);
