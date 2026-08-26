#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PRODUCTION_DEPLOY_ERROR =
  "Production --all deploy is disabled; use npm run infra:deploy-control-plane from the repository root.";

function contextValues(args) {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-c" || argument === "--context") {
      if (index + 1 < args.length) {
        values.push(args[index + 1]);
        index += 1;
      }
      continue;
    }

    if (argument.startsWith("-c=") || argument.startsWith("--context=")) {
      values.push(argument.slice(argument.indexOf("=") + 1));
    }
  }

  return values;
}

export function assertBroadInfrastructureDeployAllowed({
  deployEnvironment = process.env.DEPLOY_ENV,
  args = [],
} = {}) {
  const environment = (deployEnvironment || "production").trim().toLowerCase();
  const requestsProductionContext = contextValues(args).some((value) => {
    const separator = value.indexOf("=");
    if (separator < 0) {
      return false;
    }

    const key = value.slice(0, separator).trim();
    const contextEnvironment = value.slice(separator + 1).trim().toLowerCase();
    return key === "environment" && contextEnvironment === "production";
  });

  if (environment === "production" || requestsProductionContext) {
    const error = new Error(PRODUCTION_DEPLOY_ERROR);
    error.exitCode = 2;
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  try {
    assertBroadInfrastructureDeployAllowed({ args });
  } catch (error) {
    console.error(error instanceof Error ? error.message : PRODUCTION_DEPLOY_ERROR);
    process.exit(error?.exitCode === 2 ? 2 : 1);
  }

  const result = spawnSync(
    "cdk",
    ["deploy", "--all", "--require-approval", "never", ...args],
    { env: process.env, stdio: "inherit" },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
