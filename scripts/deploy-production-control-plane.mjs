#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { productionWorkerCdkContext, readProductionWorkerRelease } from "./production-worker-release.mjs";
import {
  readProductionProjectTargets,
  validateLiveProductionProjectTargetTransition,
} from "./production-project-targets.mjs";
import {
  BATCH_SUBMITTER_ONLY_UPDATES,
  buildExactControlPlaneTemplate,
  validateControlPlaneTemplateDiff,
  validatePreparedChangeSet,
  validateStackRollbackEnabled,
} from "./verify-control-plane-template-diff.mjs";

const root = path.resolve(import.meta.dirname, "..");
const infra = path.join(root, "infra", "aws");
const stackName = "ShortsMvpCompute-production";

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label} 값이 필요합니다.`);
  return result;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function templateSha256(template) {
  return sha256(JSON.stringify(stable(template)));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 명령이 종료 코드 ${result.status}로 실패했습니다.`);
  }
  return result.stdout || "";
}

function awsJson(args) {
  return JSON.parse(run("aws", [...args, "--output", "json"], { capture: true }));
}

function parseArgs(argv) {
  const options = {
    mode: "dry-run",
    base: process.env.PRODUCTION_BASE_SHA || "",
    region: process.env.AWS_REGION || "ap-northeast-2",
    workerImageTag: process.env.WORKER_IMAGE_TAG || "",
    legacyRerenderImageTag: process.env.LEGACY_RERENDER_IMAGE_TAG || "",
    changeSetName: "",
    changeSetId: "",
    expectedHead: "",
    expectedRegistrySha256: "",
    expectedTemplateSha256: "",
    batchSubmitterOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--prepare") options.mode = "prepare";
    else if (name === "--batch-submitter-only") options.batchSubmitterOnly = true;
    else if (name === "--execute-change-set") {
      options.mode = "execute";
      options.changeSetId = argv[++index] || "";
    } else if (name === "--change-set-name") options.changeSetName = argv[++index] || "";
    else if (name === "--base") options.base = argv[++index] || "";
    else if (name === "--region") options.region = argv[++index] || "";
    else if (name === "--worker-image-tag") options.workerImageTag = argv[++index] || "";
    else if (name === "--legacy-rerender-image-tag") {
      options.legacyRerenderImageTag = argv[++index] || "";
    } else if (name === "--expected-head") options.expectedHead = argv[++index] || "";
    else if (name === "--expected-registry-sha256") {
      options.expectedRegistrySha256 = argv[++index] || "";
    } else if (name === "--expected-template-sha256") {
      options.expectedTemplateSha256 = argv[++index] || "";
    } else if (name === "--apply" || name === "--all") {
      throw new Error(`${name}는 금지됩니다. --prepare 후 별도 --execute-change-set을 사용하세요.`);
    } else throw new Error(`알 수 없는 옵션입니다: ${name}`);
  }
  options.base = required(options.base, "--base <현재 운영 Git SHA>");
  if (!/^[0-9a-f]{40}$/.test(options.base)) {
    throw new Error("--base는 정확한 Git SHA여야 합니다.");
  }
  if (options.mode === "execute") {
    options.changeSetId = validateChangeSetId(
      required(options.changeSetId, "--execute-change-set <ChangeSetId ARN>"),
      options.region,
    );
    options.expectedHead = required(options.expectedHead, "--expected-head");
    options.expectedRegistrySha256 = required(
      options.expectedRegistrySha256,
      "--expected-registry-sha256",
    );
    options.expectedTemplateSha256 = required(
      options.expectedTemplateSha256,
      "--expected-template-sha256",
    );
    for (const [label, value] of [
      ["--expected-head", options.expectedHead],
      ["--expected-registry-sha256", options.expectedRegistrySha256],
      ["--expected-template-sha256", options.expectedTemplateSha256],
    ]) {
      if (!/^[0-9a-f]{40}$/.test(value) && label === "--expected-head") {
        throw new Error(`${label} 형식이 올바르지 않습니다.`);
      }
      if (label !== "--expected-head" && !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error(`${label} 형식이 올바르지 않습니다.`);
      }
    }
  } else {
    options.workerImageTag = required(options.workerImageTag, "--worker-image-tag");
    options.legacyRerenderImageTag = required(
      options.legacyRerenderImageTag,
      "--legacy-rerender-image-tag",
    );
    for (const name of [
      "GITHUB_OIDC_PROVIDER_ARN",
      "VERCEL_OIDC_PROVIDER_ARN",
    ]) required(process.env[name], name);
  }
  required(process.env.VERCEL_TEAM_SLUG, "VERCEL_TEAM_SLUG");
  required(process.env.VERCEL_PROJECT_NAME, "VERCEL_PROJECT_NAME");
  if (options.changeSetName && !/^[A-Za-z][-A-Za-z0-9]{0,127}$/.test(options.changeSetName)) {
    throw new Error("change set 이름 형식이 올바르지 않습니다.");
  }
  return options;
}

function selectedControlPlaneUpdates(options) {
  return options.batchSubmitterOnly ? BATCH_SUBMITTER_ONLY_UPDATES : undefined;
}

function repositoryState(base) {
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error(`작업공간이 깨끗하지 않아 중단합니다.\n${dirty}`);
  execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], {
    cwd: root,
    stdio: "ignore",
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const registrySource = fs.readFileSync(
    path.join(root, "production-project-targets.json"),
    "utf8",
  );
  return { head, registrySha256: sha256(registrySource) };
}

function liveStack(region) {
  const stack = awsJson([
    "cloudformation", "describe-stacks",
    "--stack-name", stackName,
    "--region", region,
  ]).Stacks?.[0];
  return validateStackRollbackEnabled(stack);
}

function liveTemplate(region, changeSetName = "") {
  const args = [
    "cloudformation", "get-template",
    "--stack-name", stackName,
    "--template-stage", "Original",
    "--region", region,
  ];
  if (changeSetName) args.push("--change-set-name", changeSetName);
  return awsJson(args).TemplateBody;
}

function describeChangeSet(region, changeSetIdOrName) {
  return awsJson([
    "cloudformation", "describe-change-set",
    "--stack-name", stackName,
    "--change-set-name", changeSetIdOrName,
    "--include-property-values",
    "--region", region,
  ]);
}

export function validateChangeSetId(changeSetId, region) {
  const escapedRegion = String(region).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^arn:(?:aws|aws-us-gov|aws-cn):cloudformation:${escapedRegion}:[0-9]{12}:changeSet\\/[A-Za-z][-A-Za-z0-9]{0,127}\\/[0-9a-fA-F-]{36}$`,
  );
  if (!pattern.test(String(changeSetId || ""))) {
    throw new Error("ChangeSetId는 선택한 region의 정확한 CloudFormation ARN이어야 합니다.");
  }
  return changeSetId;
}

function exactChangeSet(region, changeSetId, updateLogicalIds) {
  const expectedId = validateChangeSetId(changeSetId, region);
  const described = validatePreparedChangeSet(
    describeChangeSet(region, expectedId),
    { updateLogicalIds },
  );
  if (described.ChangeSetId !== expectedId) {
    throw new Error("CloudFormation이 반환한 ChangeSetId가 고정 ARN과 다릅니다.");
  }
  return described;
}

function discoverPreparedChangeSet(region, name, updateLogicalIds) {
  const described = describeChangeSet(region, name);
  const changeSetId = validateChangeSetId(described?.ChangeSetId, region);
  return exactChangeSet(region, changeSetId, updateLogicalIds);
}

export function validatePromotedProductionDeployment(
  deployment,
  expectedBase,
  expectedProject,
) {
  const actualSha = String(deployment?.meta?.gitCommitSha || "").trim();
  if (
    deployment?.target !== "production"
    || deployment?.readyState !== "READY"
    || deployment?.readySubstate !== "PROMOTED"
    || deployment?.project?.name !== expectedProject
    || !/^[0-9a-f]{40}$/.test(actualSha)
  ) {
    throw new Error("easycut.co.kr의 현재 promoted 운영 배포를 확인할 수 없습니다.");
  }
  if (actualSha !== expectedBase) {
    throw new Error(
      `운영 Git SHA가 기준선과 달라 중단합니다: expected=${expectedBase} actual=${actualSha}`,
    );
  }
  return actualSha;
}

function verifyPromotedProductionBaseline(expectedBase) {
  const team = required(process.env.VERCEL_TEAM_SLUG, "VERCEL_TEAM_SLUG");
  const project = required(process.env.VERCEL_PROJECT_NAME, "VERCEL_PROJECT_NAME");
  const deployment = JSON.parse(run("vercel", [
    "api", "/v13/deployments/easycut.co.kr", "--raw", "--scope", team,
  ], { capture: true }));
  return validatePromotedProductionDeployment(deployment, expectedBase, project);
}

function verifyInputsUnchanged(expected) {
  const actual = repositoryState(expected.base);
  if (actual.head !== expected.head || actual.registrySha256 !== expected.registrySha256) {
    throw new Error("검증 후 HEAD 또는 registry가 바뀌어 중단합니다.");
  }
}

function postDeployVerification(region) {
  run("node", [
    "scripts/verify-production-worker-release.mjs",
    "--release", "production-worker-release.json",
    "--lambda-function", "shorts-mvp-batch-submitter-production",
    "--region", region,
  ]);
}

function verifyProductionResources(region) {
  run("node", [
    "scripts/verify-production-worker-release.mjs",
    "--release", "production-worker-release.json",
    "--region", region,
    "--resources-only",
  ]);
}

function verifyNonterminalProductionTargets() {
  required(process.env.DATABASE_URL, "DATABASE_URL");
  required(
    process.env.PRODUCTION_DATABASE_FINGERPRINT,
    "PRODUCTION_DATABASE_FINGERPRINT",
  );
  run("node", ["scripts/verify-production-project-target-jobs.mjs"]);
}

function verifyLiveAdmissionTransition(region) {
  const environment = awsJson([
    "lambda", "get-function-configuration",
    "--function-name", "shorts-mvp-batch-submitter-production",
    "--region", region,
    "--query", "Environment.Variables",
  ]);
  return validateLiveProductionProjectTargetTransition(
    environment,
    readProductionProjectTargets(),
  );
}

export function runProductionControlPlaneDeployment(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const updateLogicalIds = selectedControlPlaneUpdates(options);
  const initial = { ...repositoryState(options.base), base: options.base };
  verifyPromotedProductionBaseline(options.base);
  liveStack(options.region);

  if (options.mode === "execute") {
    if (
      initial.head !== options.expectedHead
      || initial.registrySha256 !== options.expectedRegistrySha256
    ) {
      throw new Error("prepare 이후 HEAD 또는 registry hash가 달라져 중단합니다.");
    }
    const current = liveTemplate(options.region);
    const proposed = liveTemplate(options.region, options.changeSetId);
    if (templateSha256(proposed) !== options.expectedTemplateSha256) {
      throw new Error("prepare된 exact template hash가 예상값과 다릅니다.");
    }
    validateControlPlaneTemplateDiff(current, proposed, { updateLogicalIds });
    exactChangeSet(options.region, options.changeSetId, updateLogicalIds);
    verifyProductionResources(options.region);
    verifyLiveAdmissionTransition(options.region);
    verifyNonterminalProductionTargets();
    verifyInputsUnchanged(initial);
    verifyPromotedProductionBaseline(options.base);
    exactChangeSet(options.region, options.changeSetId, updateLogicalIds);
    // Re-read both live admission configuration and the nonterminal job set
    // immediately before execution. A prepare-time or early execute snapshot
    // is not sufficient because the production web can admit work meanwhile.
    verifyLiveAdmissionTransition(options.region);
    verifyNonterminalProductionTargets();
    run("aws", [
      "cloudformation", "execute-change-set",
      "--change-set-name", options.changeSetId,
      "--no-disable-rollback",
      "--region", options.region,
    ]);
    run("aws", [
      "cloudformation", "wait", "stack-update-complete",
      "--stack-name", stackName,
      "--region", options.region,
    ]);
    postDeployVerification(options.region);
    return;
  }

  const release = readProductionWorkerRelease(
    path.join(root, "production-worker-release.json"),
  );
  const context = {
    environment: "production",
    workerImageTag: options.workerImageTag,
    legacyRerenderImageTag: options.legacyRerenderImageTag,
    vercelTeamSlug: process.env.VERCEL_TEAM_SLUG,
    vercelProjectName: process.env.VERCEL_PROJECT_NAME,
    githubOrg: process.env.GITHUB_ORG || "dongk176",
    githubRepo: process.env.GITHUB_REPO || "shorts",
    githubOidcProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN,
    vercelOidcProviderArn: process.env.VERCEL_OIDC_PROVIDER_ARN,
    ...productionWorkerCdkContext(release),
  };
  const contextArgs = Object.entries(context).flatMap(([name, value]) => [
    "-c", `${name}=${value}`,
  ]);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-control-plane-"));
  const cdkEnvironment = {
    AWS_REGION: options.region,
    AWS_DEFAULT_REGION: options.region,
  };
  try {
    run("npm", ["run", "build"], { cwd: infra, env: cdkEnvironment });
    run("npx", [
      "cdk", "synth", stackName, "--quiet", "--exclusively",
      "--output", outputDirectory,
      ...contextArgs,
    ], { cwd: infra, env: cdkEnvironment });
    const candidatePath = path.join(outputDirectory, `${stackName}.template.json`);
    if (!fs.existsSync(candidatePath)) {
      throw new Error(`합성된 Compute template을 찾을 수 없습니다: ${candidatePath}`);
    }
    const current = liveTemplate(options.region);
    const fullCandidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    const exactCandidate = buildExactControlPlaneTemplate(current, fullCandidate, {
      updateLogicalIds,
    });
    fs.writeFileSync(candidatePath, `${JSON.stringify(exactCandidate, null, 2)}\n`, "utf8");
    const changes = validateControlPlaneTemplateDiff(current, exactCandidate, {
      updateLogicalIds,
    });
    const candidateHash = templateSha256(exactCandidate);
    verifyInputsUnchanged(initial);
    process.stdout.write([
      `Control-plane exact template 검사 통과: ${changes.length}개 허용 변경`,
      `HEAD=${initial.head}`,
      `REGISTRY_SHA256=${initial.registrySha256}`,
      `TEMPLATE_SHA256=${candidateHash}`,
      "",
    ].join("\n"));
    if (options.mode !== "prepare") {
      process.stdout.write("검사 전용입니다. change set 생성은 --prepare를 사용하세요.\n");
      return;
    }
    verifyProductionResources(options.region);
    verifyLiveAdmissionTransition(options.region);
    verifyNonterminalProductionTargets();
    verifyPromotedProductionBaseline(options.base);
    const preparedName = options.changeSetName
      || `stage-a-control-plane-${initial.head.slice(0, 12)}`;
    run("npx", [
      "cdk", "deploy", "--app", outputDirectory, stackName,
      "--exclusively",
      "--method", "prepare-change-set",
      "--change-set-name", preparedName,
      "--require-approval", "never",
      "--rollback",
    ], { cwd: infra, env: cdkEnvironment });
    const prepared = discoverPreparedChangeSet(
      options.region,
      preparedName,
      updateLogicalIds,
    );
    const changeSetId = prepared.ChangeSetId;
    const preparedTemplate = liveTemplate(options.region, changeSetId);
    if (templateSha256(preparedTemplate) !== candidateHash) {
      throw new Error("CloudFormation에 준비된 exact template hash가 후보와 다릅니다.");
    }
    exactChangeSet(options.region, changeSetId, updateLogicalIds);
    verifyInputsUnchanged(initial);
    process.stdout.write([
      `검토용 change set 생성 완료: ${preparedName}`,
      `CHANGE_SET_ID=${changeSetId}`,
      "자동 실행하지 않았습니다. 위 change set preview를 확인한 뒤 별도 실행하세요.",
      `--execute-change-set ${changeSetId}`,
      `--expected-head ${initial.head}`,
      `--expected-registry-sha256 ${initial.registrySha256}`,
      `--expected-template-sha256 ${candidateHash}`,
      "",
    ].join("\n"));
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runProductionControlPlaneDeployment();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
