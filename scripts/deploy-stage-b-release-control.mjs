#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  productionProjectTargetCdkContext,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";
import {
  STAGE_B_PHASE_CONTRACTS,
  STAGE_B_STACKS,
  buildExactStageBTemplate,
  projectExactStageBDeploymentCandidate,
  stageBStackKeys,
  validateAppliedStageBTemplate,
  validateExactStageBTemplate,
  validatePreparedStageBChangeSet,
  validateStageBPhase,
} from "./verify-stage-b-release-control-template-diff.mjs";
import {
  acquireEditorRenderV4InfrastructureLease,
  releaseEditorRenderV4InfrastructureLease,
  renewEditorRenderV4InfrastructureLease,
  verifyEditorRenderV4ReleaseControl,
} from "./verify-editor-render-v4-release-control.mjs";
import {
  verifyEditorReleaseProbeAttestation,
} from "./verify-editor-release-probe-attestation.mjs";

const root = path.resolve(import.meta.dirname, "..");
const infra = path.join(root, "infra", "aws");
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CHANGE_SET_NAME = /^[A-Za-z][-A-Za-z0-9]{0,127}$/;
// CloudFormation may legitimately take 45 minutes. A two-hour durable lease
// remains fail-closed well beyond the observation deadline if this controller
// process crashes or temporarily loses its database connection.
const LEASE_TTL_SECONDS = 2 * 60 * 60;

async function verifyStageBDatabaseContracts({ requireStopped }) {
  await verifyEditorRenderV4ReleaseControl({ requireStopped });
  await verifyEditorReleaseProbeAttestation();
}

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label} 값이 필요합니다.`);
  return result;
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stageBTemplateSha256(template) {
  return sha256(JSON.stringify(stable(template)));
}

export function stageBChangeSetProvenanceSha256(value) {
  const phase = validateStageBPhase(value?.phase);
  const stackKey = String(value?.stackKey || "");
  if (!stageBStackKeys(phase).includes(stackKey)) {
    throw new Error("Stage B provenance stack이 phase contract와 다릅니다.");
  }
  const exact = {
    phase,
    stackKey,
    base: String(value?.base || ""),
    head: String(value?.head || ""),
    registrySha256: String(value?.registrySha256 || ""),
    liveTemplateSha256: String(value?.liveTemplateSha256 || ""),
    candidateTemplateSha256: String(value?.candidateTemplateSha256 || ""),
    editorCandidateTemplateSha256: String(
      value?.editorCandidateTemplateSha256 || "",
    ),
  };
  if (!SHA.test(exact.base) || !SHA.test(exact.head)) {
    throw new Error("Stage B provenance base/head가 exact Git SHA가 아닙니다.");
  }
  for (const [name, hash] of Object.entries(exact)) {
    if (name.endsWith("Sha256") && !SHA256.test(hash)) {
      throw new Error(`Stage B provenance ${name}가 exact SHA-256이 아닙니다.`);
    }
  }
  return sha256(JSON.stringify(stable(exact)));
}

export function stageBChangeSetName(provenance) {
  const phase = validateStageBPhase(provenance?.phase);
  const stackKey = String(provenance?.stackKey || "");
  const digest = stageBChangeSetProvenanceSha256(provenance);
  return `stage-b-${phase}-${stackKey}-${digest.slice(0, 48)}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeoutMs
      ?? (["aws", "vercel"].includes(command) ? 60_000 : undefined),
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

function optionalS3HeadObject(bucket, key, region, versionId = "") {
  const args = [
    "s3api",
    "head-object",
    "--bucket",
    bucket,
    "--key",
    key,
    "--checksum-mode",
    "ENABLED",
    "--region",
    region,
    "--output",
    "json",
  ];
  if (versionId) args.push("--version-id", versionId);
  const result = spawnSync("aws", args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout || "{}");
  if (/(?:\b404\b|Not Found|NoSuchKey)/i.test(result.stderr || "")) return null;
  throw new Error("Stage B exact template S3 object 조회에 실패했습니다.");
}

function validateExactTemplateObject(head, expected) {
  if (
    !head
    || Number(head.ContentLength) !== expected.contentLength
    || head.ChecksumSHA256 !== expected.checksumSha256
    || head.ContentType !== "application/json"
    || head.ServerSideEncryption !== "AES256"
    || !String(head.VersionId || "").trim()
    || head.VersionId === "null"
  ) {
    throw new Error("Stage B exact template object가 immutable checksum 계약과 다릅니다.");
  }
  return String(head.VersionId);
}

function publishExactStageBTemplate({
  candidatePath,
  candidateTemplateSha256,
  identity,
}) {
  const templateSource = fs.readFileSync(candidatePath);
  const parsedTemplate = JSON.parse(templateSource.toString("utf8"));
  if (stageBTemplateSha256(parsedTemplate) !== candidateTemplateSha256) {
    throw new Error("업로드할 exact template hash가 메모리 후보와 다릅니다.");
  }
  const rawSha256 = crypto.createHash("sha256").update(templateSource).digest("hex");
  const checksumSha256 = crypto
    .createHash("sha256")
    .update(templateSource)
    .digest("base64");
  const bucket = `cdk-hnb659fds-assets-${identity.account}-${identity.region}`;
  const key = `stage-b/exact-templates/${rawSha256}.json`;
  if (awsJson([
    "s3api",
    "get-bucket-versioning",
    "--bucket",
    bucket,
    "--region",
    identity.region,
  ]).Status !== "Enabled") {
    throw new Error("Stage B exact template bucket의 versioning이 활성화되지 않았습니다.");
  }
  const expected = {
    checksumSha256,
    contentLength: templateSource.byteLength,
  };
  const existing = optionalS3HeadObject(bucket, key, identity.region);
  let versionId;
  if (existing) {
    versionId = validateExactTemplateObject(existing, expected);
  } else {
    const put = awsJson([
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--body",
      candidatePath,
      "--content-type",
      "application/json",
      "--server-side-encryption",
      "AES256",
      "--checksum-algorithm",
      "SHA256",
      "--checksum-sha256",
      checksumSha256,
      "--region",
      identity.region,
    ]);
    if (put.ChecksumSHA256 !== checksumSha256) {
      throw new Error("Stage B exact template 업로드 checksum이 다릅니다.");
    }
    versionId = String(put.VersionId || "").trim();
    validateExactTemplateObject(
      optionalS3HeadObject(bucket, key, identity.region, versionId),
      expected,
    );
  }
  return [
    `https://${bucket}.s3.${identity.region}.amazonaws.com/${key}`,
    `versionId=${encodeURIComponent(versionId)}`,
  ].join("?");
}

export function validateStageBChangeSetId(changeSetId, region) {
  const escapedRegion = String(region).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^arn:(?:aws|aws-us-gov|aws-cn):cloudformation:${escapedRegion}:[0-9]{12}:changeSet\\/[A-Za-z][-A-Za-z0-9]{0,127}\\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
  );
  if (!pattern.test(String(changeSetId || ""))) {
    throw new Error("ChangeSetId는 선택한 region의 정확한 CloudFormation ARN이어야 합니다.");
  }
  return changeSetId;
}

export function validatePromotedStageBDeployment(deployment, expectedBase, expectedProject) {
  const actualSha = String(deployment?.meta?.gitCommitSha || "").trim();
  if (
    deployment?.target !== "production"
    || deployment?.readyState !== "READY"
    || deployment?.readySubstate !== "PROMOTED"
    || deployment?.project?.name !== expectedProject
    || !SHA.test(actualSha)
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

export function validateRotationChangedPaths(paths) {
  const actual = [...new Set((paths || []).map((value) => String(value).trim()).filter(Boolean))];
  if (
    actual.length !== 1
    || actual[0] !== "production-project-targets.json"
  ) {
    throw new Error(
      "rotation commit은 production-project-targets.json 한 파일만 변경해야 합니다.",
    );
  }
  return actual;
}

function parseArgs(argv) {
  const options = {
    mode: "dry-run",
    executeStack: "",
    changeSetId: "",
    phase: "",
    base: process.env.PRODUCTION_BASE_SHA || "",
    head: "",
    priorStageHead: "",
    region: process.env.AWS_REGION || "ap-northeast-2",
    workerImageTag: process.env.WORKER_IMAGE_TAG || "",
    legacyRerenderImageTag: process.env.LEGACY_RERENDER_IMAGE_TAG || "",
    changeSetPrefix: "",
    expectedRegistrySha256: "",
    expectedLiveTemplateSha256: "",
    expectedTemplateSha256: "",
    expectedEditorLiveTemplateSha256: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--prepare") {
      if (options.mode !== "dry-run") {
        throw new Error("prepare와 execute mode를 함께 지정할 수 없습니다.");
      }
      options.mode = "prepare";
    }
    else if (name === "--phase") options.phase = argv[++index] || "";
    else if (name === "--base") options.base = argv[++index] || "";
    else if (name === "--head") options.head = argv[++index] || "";
    else if (name === "--prior-stage-head") options.priorStageHead = argv[++index] || "";
    else if (name === "--region") options.region = argv[++index] || "";
    else if (name === "--worker-image-tag") options.workerImageTag = argv[++index] || "";
    else if (name === "--legacy-rerender-image-tag") {
      options.legacyRerenderImageTag = argv[++index] || "";
    } else if (name === "--change-set-prefix") options.changeSetPrefix = argv[++index] || "";
    else if (name === "--execute-editor-change-set") {
      if (options.mode !== "dry-run") {
        throw new Error("prepare/execute stack은 한 번에 하나만 지정합니다.");
      }
      options.mode = "execute";
      options.executeStack = "editor";
      options.changeSetId = argv[++index] || "";
    } else if (name === "--execute-compute-change-set") {
      if (options.mode !== "dry-run") {
        throw new Error("prepare/execute stack은 한 번에 하나만 지정합니다.");
      }
      options.mode = "execute";
      options.executeStack = "compute";
      options.changeSetId = argv[++index] || "";
    } else if (name === "--expected-registry-sha256") {
      options.expectedRegistrySha256 = argv[++index] || "";
    } else if (name === "--expected-live-template-sha256") {
      options.expectedLiveTemplateSha256 = argv[++index] || "";
    } else if (name === "--expected-template-sha256") {
      options.expectedTemplateSha256 = argv[++index] || "";
    } else if (name === "--expected-editor-live-template-sha256") {
      options.expectedEditorLiveTemplateSha256 = argv[++index] || "";
    } else if (["--apply", "--all", "--deploy", "--execute-all"].includes(name)) {
      throw new Error(`${name}는 금지됩니다. stack별 prepare/execute 명령을 사용하세요.`);
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${name}`);
    }
  }

  options.phase = validateStageBPhase(options.phase);
  options.base = required(options.base, "--base <현재 promoted 운영 Git SHA>");
  options.head = required(options.head, "--head <검증할 exact Git SHA>");
  options.region = required(options.region, "--region");
  if (!SHA.test(options.base) || !SHA.test(options.head)) {
    throw new Error("--base와 --head는 정확한 40자리 Git SHA여야 합니다.");
  }
  if (options.phase === "rotation") {
    options.priorStageHead = required(
      options.priorStageHead,
      "--prior-stage-head <bootstrap exact Git SHA>",
    );
    if (!SHA.test(options.priorStageHead) || options.priorStageHead === options.head) {
      throw new Error("rotation의 --prior-stage-head는 HEAD와 다른 정확한 Git SHA여야 합니다.");
    }
  } else if (options.priorStageHead) {
    throw new Error("--prior-stage-head는 rotation 단계에서만 사용합니다.");
  }
  if (["renewal", "lockdown"].includes(options.phase) && options.executeStack === "compute") {
    throw new Error(`${options.phase}은 editor stack만 실행할 수 있습니다.`);
  }
  if (options.changeSetPrefix && !CHANGE_SET_NAME.test(options.changeSetPrefix)) {
    throw new Error("change set prefix 형식이 올바르지 않습니다.");
  }
  if (options.changeSetPrefix) {
    throw new Error(
      "--change-set-prefix는 사용할 수 없습니다. exact provenance 기반 이름만 허용됩니다.",
    );
  }

  required(process.env.VERCEL_TEAM_SLUG, "VERCEL_TEAM_SLUG");
  required(process.env.VERCEL_PROJECT_NAME, "VERCEL_PROJECT_NAME");
  options.workerImageTag = required(options.workerImageTag, "--worker-image-tag");
  options.legacyRerenderImageTag = required(
    options.legacyRerenderImageTag,
    "--legacy-rerender-image-tag",
  );
  required(process.env.GITHUB_OIDC_PROVIDER_ARN, "GITHUB_OIDC_PROVIDER_ARN");
  required(process.env.VERCEL_OIDC_PROVIDER_ARN, "VERCEL_OIDC_PROVIDER_ARN");
  for (const name of ["GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID"]) {
    if (!/^[1-9][0-9]*$/.test(required(process.env[name], name))) {
      throw new Error(`${name}는 GitHub의 정확한 숫자 ID여야 합니다.`);
    }
  }

  if (options.mode === "execute") {
    options.changeSetId = validateStageBChangeSetId(
      required(options.changeSetId, "exact ChangeSetId ARN"),
      options.region,
    );
    for (const [label, value] of [
      ["--expected-registry-sha256", options.expectedRegistrySha256],
      ["--expected-live-template-sha256", options.expectedLiveTemplateSha256],
      ["--expected-template-sha256", options.expectedTemplateSha256],
    ]) {
      if (!SHA256.test(required(value, label))) {
        throw new Error(`${label}는 정확한 SHA-256이어야 합니다.`);
      }
    }
    if (options.executeStack === "compute") {
      if (!SHA256.test(required(
        options.expectedEditorLiveTemplateSha256,
        "--expected-editor-live-template-sha256",
      ))) {
        throw new Error("--expected-editor-live-template-sha256는 정확한 SHA-256이어야 합니다.");
      }
    } else if (options.expectedEditorLiveTemplateSha256) {
      throw new Error("editor 실행에는 --expected-editor-live-template-sha256를 사용하지 않습니다.");
    }
  }
  return options;
}

function gitIsAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(`${ancestor}가 ${descendant}의 ancestor가 아니어서 중단합니다.`);
  }
}

function repositoryState(options) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error(`작업공간이 깨끗하지 않아 중단합니다.\n${dirty}`);
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (actualHead !== options.head) {
    throw new Error(`exact HEAD가 달라 중단합니다: expected=${options.head} actual=${actualHead}`);
  }
  gitIsAncestor(options.base, options.head);
  if (options.phase === "rotation") {
    gitIsAncestor(options.base, options.priorStageHead);
    gitIsAncestor(options.priorStageHead, options.head);
    const paths = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${options.priorStageHead}..${options.head}`],
      { cwd: root, encoding: "utf8" },
    ).split("\n");
    validateRotationChangedPaths(paths);
  }
  const registrySource = fs.readFileSync(
    path.join(root, "production-project-targets.json"),
    "utf8",
  );
  return {
    base: options.base,
    head: actualHead,
    registrySha256: sha256(registrySource),
  };
}

function verifyRepositoryUnchanged(options, expected) {
  const actual = repositoryState(options);
  if (
    actual.head !== expected.head
    || actual.registrySha256 !== expected.registrySha256
  ) {
    throw new Error("검증 중 HEAD 또는 production target registry가 바뀌어 중단합니다.");
  }
}

function verifyPromotedProductionBaseline(expectedBase) {
  const team = required(process.env.VERCEL_TEAM_SLUG, "VERCEL_TEAM_SLUG");
  const project = required(process.env.VERCEL_PROJECT_NAME, "VERCEL_PROJECT_NAME");
  const deployment = JSON.parse(run("vercel", [
    "api",
    "/v13/deployments/easycut.co.kr",
    "--raw",
    "--scope",
    team,
  ], { capture: true }));
  return validatePromotedStageBDeployment(deployment, expectedBase, project);
}

function productionIdentity(registry, region) {
  const identities = new Set();
  for (const lane of Object.values(registry.lanes)) {
    for (const target of [lane.current, lane.previous].filter(Boolean)) {
      const match = /^arn:aws:batch:([a-z0-9-]+):([0-9]{12}):job-definition\//.exec(
        target.jobDefinitionArn,
      );
      if (!match) throw new Error("production target의 AWS identity를 확인할 수 없습니다.");
      identities.add(`${match[1]}:${match[2]}`);
    }
  }
  if (identities.size !== 1) throw new Error("production target AWS identity가 하나가 아닙니다.");
  const [targetRegion, account] = [...identities][0].split(":");
  if (targetRegion !== region) {
    throw new Error(`선택한 region이 production target과 다릅니다: ${region}`);
  }
  const caller = awsJson(["sts", "get-caller-identity"]);
  if (String(caller.Account || "") !== account) {
    throw new Error(`AWS account가 production target과 다릅니다: ${caller.Account || "unknown"}`);
  }
  return { account, region: targetRegion };
}

function stableRerenderDefinitionArn() {
  const context = JSON.parse(fs.readFileSync(
    path.join(infra, "cdk.context.json"),
    "utf8",
  ));
  return required(
    context["editorStableRerenderJobDefinitionArn:production"],
    "editorStableRerenderJobDefinitionArn:production",
  );
}

function registrarPassRoleArns(registry, identity) {
  const definitionArns = new Set([stableRerenderDefinitionArn()]);
  for (const lane of Object.values(registry.lanes)) {
    for (const target of [lane.current, lane.previous].filter(Boolean)) {
      definitionArns.add(target.jobDefinitionArn);
    }
  }
  const roles = new Set([
    `arn:aws:iam::${identity.account}:role/shorts-mvp-editor-test-task`,
    `arn:aws:iam::${identity.account}:role/shorts-mvp-editor-test-execution`,
  ]);
  for (const definitionArn of [...definitionArns].sort()) {
    const definitions = awsJson([
      "batch",
      "describe-job-definitions",
      "--job-definitions",
      definitionArn,
      "--region",
      identity.region,
    ]).jobDefinitions || [];
    if (
      definitions.length !== 1
      || definitions[0].jobDefinitionArn !== definitionArn
      || definitions[0].status !== "ACTIVE"
    ) {
      throw new Error(`trusted Job Definition이 ACTIVE exact ARN이 아닙니다: ${definitionArn}`);
    }
    const container = definitions[0].containerProperties || {};
    for (const name of ["jobRoleArn", "executionRoleArn"]) {
      const roleArn = required(container[name], `${definitionArn} ${name}`);
      if (
        !roleArn.startsWith(`arn:aws:iam::${identity.account}:role/`)
        || roleArn.includes("*")
      ) {
        throw new Error(`trusted Job Definition의 ${name}이 exact same-account ARN이 아닙니다.`);
      }
      roles.add(roleArn);
    }
  }
  return [...roles].sort();
}

function liveStack(stackKey, region) {
  const contract = STAGE_B_STACKS[stackKey];
  const stack = awsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    contract.stackName,
    "--region",
    region,
  ]).Stacks?.[0];
  if (
    !stack
    || !["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(
      stack.StackStatus,
    )
    || stack.DisableRollback === true
  ) {
    throw new Error(`${contract.stackName} stack이 안정적이고 rollback 가능한 상태가 아닙니다.`);
  }
  return stack;
}

function liveTemplate(stackKey, region, changeSetId = "") {
  const contract = STAGE_B_STACKS[stackKey];
  const args = [
    "cloudformation",
    "get-template",
    "--stack-name",
    contract.stackName,
    "--template-stage",
    "Original",
    "--region",
    region,
  ];
  if (changeSetId) args.push("--change-set-name", changeSetId);
  return awsJson(args).TemplateBody;
}

export function stageBChangedLambdaCodeAssets(
  currentTemplates,
  exactTemplates,
  identity,
) {
  const expectedBucket = `cdk-hnb659fds-assets-${identity.account}-${identity.region}`;
  const assets = [];
  for (const stackKey of Object.keys(exactTemplates).sort()) {
    const currentResources = currentTemplates[stackKey]?.Resources || {};
    const exactResources = exactTemplates[stackKey]?.Resources || {};
    for (const logicalId of Object.keys(exactResources).sort()) {
      const exactResource = exactResources[logicalId];
      if (exactResource?.Type !== "AWS::Lambda::Function") continue;
      const currentCode = currentResources[logicalId]?.Properties?.Code;
      const exactCode = exactResource?.Properties?.Code;
      if (JSON.stringify(stable(currentCode)) === JSON.stringify(stable(exactCode))) {
        continue;
      }
      if (
        !exactCode
        || Object.keys(exactCode).sort().join(",") !== "S3Bucket,S3Key"
        || exactCode.S3Bucket !== expectedBucket
        || !/^[0-9a-f]{64}\.zip$/.test(String(exactCode.S3Key || ""))
      ) {
        throw new Error(
          `${stackKey}/${logicalId} Lambda Code가 exact CDK file asset이 아닙니다.`,
        );
      }
      assets.push({
        stackKey,
        logicalId,
        bucket: exactCode.S3Bucket,
        key: exactCode.S3Key,
      });
    }
  }
  return assets;
}

function publishAndVerifyStageBAssets({
  options,
  stackKeys,
  outputDirectory,
  cdkEnvironment,
  currentTemplates,
  exactTemplates,
  identity,
}) {
  const assets = stageBChangedLambdaCodeAssets(
    currentTemplates,
    exactTemplates,
    identity,
  );
  if (!assets.length) return;
  run("npx", [
    "cdk",
    "publish-assets",
    "--unstable=publish-assets",
    ...stackKeys.map((stackKey) => STAGE_B_STACKS[stackKey].stackName),
    "--app",
    outputDirectory,
    "--exclusively",
    "--yes",
    "--concurrency",
    "1",
    "--region",
    options.region,
  ], { cwd: infra, env: cdkEnvironment });
  for (const asset of assets) {
    const head = optionalS3HeadObject(
      asset.bucket,
      asset.key,
      options.region,
    );
    if (
      !head
      || Number(head.ContentLength) <= 0
      || head.ServerSideEncryption !== "AES256"
      || !String(head.VersionId || "").trim()
      || head.VersionId === "null"
    ) {
      throw new Error(
        `${asset.stackKey}/${asset.logicalId} Lambda asset 게시 검증에 실패했습니다.`,
      );
    }
  }
}

function describeChangeSet(stackKey, region, idOrName) {
  return awsJson([
    "cloudformation",
    "describe-change-set",
    "--stack-name",
    STAGE_B_STACKS[stackKey].stackName,
    "--change-set-name",
    idOrName,
    "--include-property-values",
    "--region",
    region,
  ]);
}

function exactChangeSet(phase, stackKey, region, changeSetId) {
  const expectedId = validateStageBChangeSetId(changeSetId, region);
  const described = validatePreparedStageBChangeSet(
    phase,
    stackKey,
    describeChangeSet(stackKey, region, expectedId),
  );
  if (described.ChangeSetId !== expectedId) {
    throw new Error("CloudFormation이 반환한 ChangeSetId가 고정 ARN과 다릅니다.");
  }
  return described;
}

function discoverPreparedChangeSet(phase, stackKey, region, name) {
  const described = describeChangeSet(stackKey, region, name);
  const changeSetId = validateStageBChangeSetId(described?.ChangeSetId, region);
  return exactChangeSet(phase, stackKey, region, changeSetId);
}

function assertChangeSetNameUnused(stackKey, region, name) {
  const result = spawnSync("aws", [
    "cloudformation",
    "describe-change-set",
    "--stack-name",
    STAGE_B_STACKS[stackKey].stackName,
    "--change-set-name",
    name,
    "--region",
    region,
    "--output",
    "json",
  ], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`동일한 change set 이름이 이미 존재합니다: ${name}`);
  }
  const message = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/(?:does not exist|not found)/i.test(message)) {
    throw new Error(`change set 이름 사전 확인에 실패했습니다: ${name}`);
  }
}

function verifierOptions(options, registry, identity) {
  return {
    phase: options.phase,
    githubOrg: process.env.GITHUB_ORG || "dongk176",
    githubRepo: process.env.GITHUB_REPO || "shorts",
    githubEditorReleaseRef: STAGE_B_PHASE_CONTRACTS[options.phase].editorReleaseRef,
    githubRepositoryId: required(
      process.env.GITHUB_REPOSITORY_ID,
      "GITHUB_REPOSITORY_ID",
    ),
    githubRepositoryOwnerId: required(
      process.env.GITHUB_REPOSITORY_OWNER_ID,
      "GITHUB_REPOSITORY_OWNER_ID",
    ),
    registrarPassRoleArns: registrarPassRoleArns(registry, identity),
    projectTargets: registry,
  };
}

function stageBCdkContext(options, registry, validationOptions) {
  return {
    environment: "production",
    workerImageTag: options.workerImageTag,
    legacyRerenderImageTag: options.legacyRerenderImageTag,
    vercelTeamSlug: process.env.VERCEL_TEAM_SLUG,
    vercelProjectName: process.env.VERCEL_PROJECT_NAME,
    githubOrg: process.env.GITHUB_ORG || "dongk176",
    githubRepo: process.env.GITHUB_REPO || "shorts",
    githubOidcProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN,
    vercelOidcProviderArn: process.env.VERCEL_OIDC_PROVIDER_ARN,
    githubEditorReleaseRef:
      STAGE_B_PHASE_CONTRACTS[options.phase].editorReleaseRef,
    githubRepositoryId: validationOptions.githubRepositoryId,
    githubRepositoryOwnerId: validationOptions.githubRepositoryOwnerId,
    editorReleaseRegistrarPassRoleArns: JSON.stringify(
      validationOptions.registrarPassRoleArns,
    ),
    ...productionProjectTargetCdkContext(registry),
  };
}

function synthesizeStageBTemplates(options, registry, stackKeys, validationOptions) {
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "shorts-stage-b-control-"),
  );
  const cdkEnvironment = {
    AWS_REGION: options.region,
    AWS_DEFAULT_REGION: options.region,
  };
  try {
    const contextArgs = Object.entries(stageBCdkContext(options, registry, validationOptions))
      .flatMap(([name, value]) => ["-c", `${name}=${value}`]);
    run("npm", ["run", "build"], { cwd: infra, env: cdkEnvironment });
    run("npx", [
      "cdk",
      "synth",
      ...stackKeys.map((stackKey) => STAGE_B_STACKS[stackKey].stackName),
      "--quiet",
      "--exclusively",
      "--output",
      outputDirectory,
      ...contextArgs,
    ], { cwd: infra, env: cdkEnvironment });
    const fullCandidates = {};
    for (const stackKey of stackKeys) {
      const candidatePath = path.join(
        outputDirectory,
        STAGE_B_STACKS[stackKey].templateFile,
      );
      if (!fs.existsSync(candidatePath)) {
        throw new Error(
          `${stackKey} 합성 template을 찾을 수 없습니다: ${candidatePath}`,
        );
      }
      fullCandidates[stackKey] = JSON.parse(
        fs.readFileSync(candidatePath, "utf8"),
      );
    }
    return { outputDirectory, cdkEnvironment, fullCandidates };
  } catch (error) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

function changeSetProvenance(
  options,
  initial,
  stackKey,
  liveTemplateSha256,
  candidateTemplateSha256,
  editorCandidateTemplateSha256,
) {
  const provenance = {
    phase: options.phase,
    stackKey,
    base: initial.base,
    head: initial.head,
    registrySha256: initial.registrySha256,
    liveTemplateSha256,
    candidateTemplateSha256,
    editorCandidateTemplateSha256,
  };
  return {
    ...provenance,
    digest: stageBChangeSetProvenanceSha256(provenance),
    changeSetName: stageBChangeSetName(provenance),
  };
}

function verifyLiveHashes(stackKeys, region, expectedHashes) {
  for (const stackKey of stackKeys) {
    const actual = stageBTemplateSha256(liveTemplate(stackKey, region));
    if (actual !== expectedHashes[stackKey]) {
      throw new Error(`${stackKey} live template이 검증 중 변경되어 중단합니다.`);
    }
  }
}

function prepareChangeSet(
  options,
  stackKey,
  outputDirectory,
  name,
  candidateHash,
  exactTemplate,
  currentTemplate,
  validationOptions,
  identity,
) {
  const candidatePath = path.join(
    outputDirectory,
    STAGE_B_STACKS[stackKey].templateFile,
  );
  const templateUrl = publishExactStageBTemplate({
    candidatePath,
    candidateTemplateSha256: candidateHash,
    identity,
  });
  const stack = liveStack(stackKey, options.region);
  const capabilities = [...new Set(stack.Capabilities || [])].sort();
  if (
    !capabilities.length
    || capabilities.some((value) => ![
      "CAPABILITY_AUTO_EXPAND",
      "CAPABILITY_IAM",
      "CAPABILITY_NAMED_IAM",
    ].includes(value))
  ) {
    throw new Error(`${stackKey} stack capability 계약이 올바르지 않습니다.`);
  }
  const roleArn = String(stack.RoleARN || "");
  if (
    roleArn !== `arn:aws:iam::${identity.account}:role/cdk-hnb659fds-cfn-exec-role-${identity.account}-${identity.region}`
  ) {
    throw new Error(`${stackKey} CloudFormation 실행 role이 exact bootstrap role과 다릅니다.`);
  }
  const parameters = (stack.Parameters || []).map((parameter) => {
    const key = String(parameter?.ParameterKey || "");
    if (!/^[A-Za-z][A-Za-z0-9]{0,254}$/.test(key)) {
      throw new Error(`${stackKey} stack parameter key가 올바르지 않습니다.`);
    }
    return `ParameterKey=${key},UsePreviousValue=true`;
  });
  const createArgs = [
    "cloudformation",
    "create-change-set",
    "--stack-name",
    STAGE_B_STACKS[stackKey].stackName,
    "--change-set-name",
    name,
    "--change-set-type",
    "UPDATE",
    "--template-url",
    templateUrl,
    "--role-arn",
    roleArn,
    "--capabilities",
    ...capabilities,
    "--description",
    `Stage B ${options.phase}/${stackKey} exact ${candidateHash}`,
    "--region",
    options.region,
  ];
  if (parameters.length) createArgs.push("--parameters", ...parameters);
  const created = awsJson(createArgs);
  validateStageBChangeSetId(created.Id, options.region);
  run("aws", [
    "cloudformation",
    "wait",
    "change-set-create-complete",
    "--stack-name",
    STAGE_B_STACKS[stackKey].stackName,
    "--change-set-name",
    created.Id,
    "--region",
    options.region,
  ]);
  const prepared = discoverPreparedChangeSet(
    options.phase,
    stackKey,
    options.region,
    name,
  );
  const proposed = liveTemplate(stackKey, options.region, prepared.ChangeSetId);
  if (stageBTemplateSha256(proposed) !== candidateHash) {
    throw new Error(`${stackKey} prepared template hash가 exact 후보와 다릅니다.`);
  }
  validateExactStageBTemplate(
    options.phase,
    stackKey,
    currentTemplate,
    proposed,
    validationOptions,
  );
  if (stageBTemplateSha256(exactTemplate) !== candidateHash) {
    throw new Error(`${stackKey} exact template hash가 메모리 후보와 달라졌습니다.`);
  }
  return prepared;
}

function cleanupPreparedChangeSets(region, preparedRecords) {
  for (const record of [...preparedRecords].reverse()) {
    let identifier = record.id;
    try {
      if (!identifier) {
        const described = describeChangeSet(record.stackKey, region, record.name);
        if (
          described?.StackName !== STAGE_B_STACKS[record.stackKey].stackName
          || described?.ChangeSetName !== record.name
        ) {
          throw new Error("임시 change set identity가 예상값과 다릅니다.");
        }
        identifier = validateStageBChangeSetId(described.ChangeSetId, region);
      }
      run("aws", [
        "cloudformation",
        "delete-change-set",
        "--stack-name",
        STAGE_B_STACKS[record.stackKey].stackName,
        "--change-set-name",
        identifier,
        "--region",
        region,
      ]);
    } catch (error) {
      process.stderr.write(
        `실패한 prepare의 임시 change set 정리도 실패했습니다: ${identifier || record.name} (${error instanceof Error ? error.message : String(error)})\n`,
      );
    }
  }
}

export function assertChangeSetProvenance(
  changeSet,
  expectedName,
  expectedId,
) {
  if (
    changeSet?.ChangeSetName !== expectedName
    || changeSet?.ChangeSetId !== expectedId
    || !String(expectedId).includes(`:changeSet/${expectedName}/`)
  ) {
    throw new Error(
      "prepared ChangeSet이 exact phase/stack/base/head/registry/template provenance와 다릅니다.",
    );
  }
  return changeSet;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const STACK_UPDATE_ACTIVITY_STATUSES = new Set([
  "UPDATE_IN_PROGRESS",
  "UPDATE_FAILED",
  "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
]);
const STACK_ROLLBACK_TERMINAL_STATUSES = new Set([
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
]);
const CHANGE_SET_EXECUTION_ACTIVITY_STATUSES = new Set([
  "EXECUTE_IN_PROGRESS",
  "EXECUTE_COMPLETE",
  "OBSOLETE",
  "UNAVAILABLE",
]);

export function classifyStageBStackObservation({
  stackStatus,
  candidateTemplateMatches,
  changeSetExecutionStatus,
  executionActivityObserved = false,
  stackUpdateActivityObserved = false,
  originalStackStatus = "",
}) {
  const status = String(stackStatus || "");
  const executionStatus = String(changeSetExecutionStatus || "");
  const stackActivityObserved = Boolean(
    stackUpdateActivityObserved
    || STACK_UPDATE_ACTIVITY_STATUSES.has(status)
    || candidateTemplateMatches,
  );
  const activityObserved = Boolean(
    executionActivityObserved
    || stackActivityObserved
    || CHANGE_SET_EXECUTION_ACTIVITY_STATUSES.has(executionStatus)
  );
  if (status === "UPDATE_COMPLETE" && candidateTemplateMatches) {
    return {
      state: "succeeded",
      activityObserved: true,
      stackActivityObserved: true,
    };
  }
  if (
    STACK_ROLLBACK_TERMINAL_STATUSES.has(status)
    && (
      stackActivityObserved
      || (status === "UPDATE_ROLLBACK_FAILED" && activityObserved)
      || (originalStackStatus && status !== originalStackStatus)
    )
  ) {
    return {
      state: "rolled_back",
      activityObserved: true,
      stackActivityObserved: true,
    };
  }
  return { state: "pending", activityObserved, stackActivityObserved };
}

export function shouldReleaseStageBInfrastructureLease({
  leaseAcquired,
  executionMayHaveStarted,
  executionTerminalKnown,
}) {
  return Boolean(
    leaseAcquired
    && (!executionMayHaveStarted || executionTerminalKnown),
  );
}

class StageBTerminalExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = "StageBTerminalExecutionError";
    this.terminalKnown = true;
  }
}

export async function waitForStageBStackUpdate({
  options,
  stackKey,
  changeSetId,
  originalStackStatus,
  candidateTemplateSha256,
  leaseOwner,
  leaseId,
  deadlineMs = 45 * 60 * 1000,
  dependencies = {},
}) {
  const now = dependencies.now || Date.now;
  const sleep = dependencies.wait || wait;
  const renewLease = dependencies.renewLease
    || renewEditorRenderV4InfrastructureLease;
  const readStack = dependencies.readStack || (() => awsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    STAGE_B_STACKS[stackKey].stackName,
    "--region",
    options.region,
  ]).Stacks?.[0]);
  const readChangeSet = dependencies.readChangeSet || (() => (
    describeChangeSet(stackKey, options.region, changeSetId)
  ));
  const readLiveTemplateSha256 = dependencies.readLiveTemplateSha256
    || (() => stageBTemplateSha256(liveTemplate(stackKey, options.region)));
  const warn = dependencies.warn || ((message) => process.stderr.write(message));
  const startedAt = now();
  let executionActivityObserved = false;
  let stackUpdateActivityObserved = false;
  let lastRenewalError = null;
  let lastObservationError = null;
  for (;;) {
    try {
      await renewLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      lastRenewalError = null;
    } catch (error) {
      lastRenewalError = error;
      warn(
        `Stage B lease 갱신 실패; 기존 2시간 lease를 유지하며 CloudFormation terminal 상태를 계속 확인합니다: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    try {
      const stack = readStack();
      const stackStatus = String(stack?.StackStatus || "");
      const liveTemplateSha256 = readLiveTemplateSha256();
      if (
        stackStatus === "UPDATE_COMPLETE"
        && liveTemplateSha256 === candidateTemplateSha256
      ) {
        return stack;
      }
      let changeSetExecutionStatus = "";
      try {
        const changeSet = readChangeSet();
        changeSetExecutionStatus = String(changeSet?.ExecutionStatus || "");
        lastObservationError = null;
      } catch (error) {
        // Executed change sets may stop being describable before the stack
        // reaches its terminal state. Stack status/template remain authoritative.
        lastObservationError = error;
      }
      const observation = classifyStageBStackObservation({
        stackStatus,
        candidateTemplateMatches:
          liveTemplateSha256 === candidateTemplateSha256,
        changeSetExecutionStatus,
        executionActivityObserved,
        stackUpdateActivityObserved,
        originalStackStatus,
      });
      executionActivityObserved = observation.activityObserved;
      stackUpdateActivityObserved = observation.stackActivityObserved;

      if (observation.state === "succeeded") return stack;
      if (observation.state === "rolled_back") {
        throw new StageBTerminalExecutionError(
          `${stackKey} CloudFormation update가 rollback terminal 상태로 종료됐습니다: ${stackStatus}`,
        );
      }

      // Even AVAILABLE plus the original template cannot prove that a timed-out
      // execute request was rejected; CloudFormation may still be propagating
      // an accepted call. Only a success or observed rollback is terminal.
    } catch (error) {
      if (error instanceof StageBTerminalExecutionError) throw error;
      lastObservationError = error;
      warn(
        `Stage B CloudFormation 상태 조회 실패; terminal 여부가 확인될 때까지 lease를 유지합니다: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    if (now() - startedAt >= deadlineMs) {
      const details = [
        lastRenewalError instanceof Error
          ? `lease=${lastRenewalError.message}`
          : "",
        lastObservationError instanceof Error
          ? `aws=${lastObservationError.message}`
          : "",
      ].filter(Boolean).join(" ");
      throw new Error(
        `${stackKey} CloudFormation update terminal 상태 감시 시간이 초과됐습니다.${details ? ` ${details}` : ""}`,
      );
    }
    await sleep(10_000);
  }
}

async function executeChangeSet(options, initial, registry) {
  const stackKey = options.executeStack;
  if (!stageBStackKeys(options.phase).includes(stackKey)) {
    throw new Error(`${options.phase} 단계에서 ${stackKey} stack 실행은 허용되지 않습니다.`);
  }
  if (initial.registrySha256 !== options.expectedRegistrySha256) {
    throw new Error(
      "입력한 registry hash가 exact HEAD에서 직접 계산한 hash와 다릅니다.",
    );
  }
  const identity = productionIdentity(registry, options.region);
  const validationOptions = verifierOptions(options, registry, identity);
  const originalStackStatus = String(
    liveStack(stackKey, options.region).StackStatus || "",
  );
  const stackKeys = stageBStackKeys(options.phase);
  const synthesized = synthesizeStageBTemplates(
    options,
    registry,
    stackKeys,
    validationOptions,
  );
  try {
    const current = liveTemplate(stackKey, options.region);
    const deploymentCandidate = projectExactStageBDeploymentCandidate(
      options.phase,
      stackKey,
      current,
      synthesized.fullCandidates[stackKey],
    );
    const exact = buildExactStageBTemplate(
      options.phase,
      stackKey,
      current,
      deploymentCandidate,
      validationOptions,
    );
    validateExactStageBTemplate(
      options.phase,
      stackKey,
      current,
      exact,
      validationOptions,
    );
    const liveTemplateSha256 = stageBTemplateSha256(current);
    const candidateTemplateSha256 = stageBTemplateSha256(exact);
    let editorCandidateTemplateSha256 = candidateTemplateSha256;
    if (stackKey === "compute") {
      liveStack("editor", options.region);
      const editorLive = liveTemplate("editor", options.region);
      const editorDeploymentCandidate = projectExactStageBDeploymentCandidate(
        options.phase,
        "editor",
        editorLive,
        synthesized.fullCandidates.editor,
      );
      validateAppliedStageBTemplate(
        options.phase,
        "editor",
        editorLive,
        editorDeploymentCandidate,
        validationOptions,
      );
      editorCandidateTemplateSha256 = stageBTemplateSha256(editorLive);
    }
    if (liveTemplateSha256 !== options.expectedLiveTemplateSha256) {
      throw new Error(
        `${stackKey} 입력 live hash가 AWS에서 직접 읽은 template hash와 다릅니다.`,
      );
    }
    if (candidateTemplateSha256 !== options.expectedTemplateSha256) {
      throw new Error(
        `${stackKey} 입력 candidate hash가 exact HEAD 내부 합성 hash와 다릅니다.`,
      );
    }
    if (
      stackKey === "compute"
      && editorCandidateTemplateSha256
        !== options.expectedEditorLiveTemplateSha256
    ) {
      throw new Error(
        "입력 Editor hash가 exact HEAD 내부 합성과 live 적용 검증 결과와 다릅니다.",
      );
    }
    const provenance = changeSetProvenance(
      options,
      initial,
      stackKey,
      liveTemplateSha256,
      candidateTemplateSha256,
      editorCandidateTemplateSha256,
    );
    const proposed = liveTemplate(
      stackKey,
      options.region,
      options.changeSetId,
    );
    if (stageBTemplateSha256(proposed) !== candidateTemplateSha256) {
      throw new Error("prepare된 exact template hash가 현재 HEAD 합성 후보와 다릅니다.");
    }
    validateExactStageBTemplate(
      options.phase,
      stackKey,
      current,
      proposed,
      validationOptions,
    );
    assertChangeSetProvenance(
      exactChangeSet(options.phase, stackKey, options.region, options.changeSetId),
      provenance.changeSetName,
      options.changeSetId,
    );

    verifyRepositoryUnchanged(options, initial);
    verifyPromotedProductionBaseline(options.base);
    liveStack(stackKey, options.region);
    const lastCurrent = liveTemplate(stackKey, options.region);
    if (stageBTemplateSha256(lastCurrent) !== liveTemplateSha256) {
      throw new Error(`${stackKey} live template이 실행 직전에 변경되었습니다.`);
    }
    if (stackKey === "compute") {
      const editorLive = liveTemplate("editor", options.region);
      const editorDeploymentCandidate = projectExactStageBDeploymentCandidate(
        options.phase,
        "editor",
        editorLive,
        synthesized.fullCandidates.editor,
      );
      validateAppliedStageBTemplate(
        options.phase,
        "editor",
        editorLive,
        editorDeploymentCandidate,
        validationOptions,
      );
      if (
        stageBTemplateSha256(editorLive)
        !== editorCandidateTemplateSha256
      ) {
        throw new Error("EditorCanary exact HEAD template이 실행 직전에 변경되었습니다.");
      }
    }
    const lastProposed = liveTemplate(
      stackKey,
      options.region,
      options.changeSetId,
    );
    if (stageBTemplateSha256(lastProposed) !== candidateTemplateSha256) {
      throw new Error("change set template이 실행 직전에 변경되었습니다.");
    }
    assertChangeSetProvenance(
      exactChangeSet(options.phase, stackKey, options.region, options.changeSetId),
      provenance.changeSetName,
      options.changeSetId,
    );
    await verifyStageBDatabaseContracts({
      requireStopped: options.phase !== "lockdown",
    });

    const leasePhase = options.phase === "renewal" ? "bootstrap" : options.phase;
    const leaseOwner = `stage-b:${leasePhase}:${initial.head}`;
    const leaseId = crypto.randomUUID();
    let leaseAcquired = false;
    let executionMayHaveStarted = false;
    let executionTerminalKnown = true;
    let primaryError = null;
    try {
      await acquireEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      leaseAcquired = true;
      verifyRepositoryUnchanged(options, initial);
      verifyPromotedProductionBaseline(options.base);
      await renewEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      if (
        stageBTemplateSha256(liveTemplate(stackKey, options.region))
        !== liveTemplateSha256
      ) {
        throw new Error(`${stackKey} live template이 lease 획득 후 변경되었습니다.`);
      }
      await renewEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      if (stackKey === "compute") {
        const editorLive = liveTemplate("editor", options.region);
        const editorDeploymentCandidate = projectExactStageBDeploymentCandidate(
          options.phase,
          "editor",
          editorLive,
          synthesized.fullCandidates.editor,
        );
        validateAppliedStageBTemplate(
          options.phase,
          "editor",
          editorLive,
          editorDeploymentCandidate,
          validationOptions,
        );
        if (
          stageBTemplateSha256(editorLive)
          !== editorCandidateTemplateSha256
        ) {
          throw new Error("EditorCanary template이 lease 획득 후 변경되었습니다.");
        }
        await renewEditorRenderV4InfrastructureLease({
          owner: leaseOwner,
          leaseId,
          ttlSeconds: LEASE_TTL_SECONDS,
        });
      }
      if (
        stageBTemplateSha256(liveTemplate(
          stackKey,
          options.region,
          options.changeSetId,
        )) !== candidateTemplateSha256
      ) {
        throw new Error("change set template이 lease 획득 후 변경되었습니다.");
      }
      await renewEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      assertChangeSetProvenance(
        exactChangeSet(
          options.phase,
          stackKey,
          options.region,
          options.changeSetId,
        ),
        provenance.changeSetName,
        options.changeSetId,
      );
      await renewEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      executionMayHaveStarted = true;
      executionTerminalKnown = false;
      let executeCommandError = null;
      try {
        run("aws", [
          "cloudformation",
          "execute-change-set",
          "--change-set-name",
          options.changeSetId,
          "--no-disable-rollback",
          "--region",
          options.region,
        ]);
      } catch (error) {
        // A CLI timeout or transport error cannot prove that CloudFormation did
        // not accept the request. Always reconcile the stack/change-set state.
        executeCommandError = error;
      }
      try {
        await waitForStageBStackUpdate({
          options,
          stackKey,
          changeSetId: options.changeSetId,
          originalStackStatus,
          candidateTemplateSha256,
          leaseOwner,
          leaseId,
        });
        executionTerminalKnown = true;
      } catch (error) {
        if (error instanceof StageBTerminalExecutionError) {
          executionTerminalKnown = true;
        }
        if (executeCommandError && error instanceof StageBTerminalExecutionError) {
          throw new StageBTerminalExecutionError(
            `${error.message} execute-change-set 오류: ${executeCommandError instanceof Error ? executeCommandError.message : String(executeCommandError)}`,
          );
        }
        throw error;
      }
      if (executeCommandError) {
        process.stderr.write(
          `execute-change-set 명령은 오류를 반환했지만 AWS terminal 성공 상태가 직접 확인됐습니다: ${executeCommandError instanceof Error ? executeCommandError.message : String(executeCommandError)}\n`,
        );
      }
      await renewEditorRenderV4InfrastructureLease({
        owner: leaseOwner,
        leaseId,
        ttlSeconds: LEASE_TTL_SECONDS,
      });
      await verifyStageBDatabaseContracts({
        requireStopped: options.phase !== "lockdown",
      });
      liveStack(stackKey, options.region);
      const finalHash = stageBTemplateSha256(
        liveTemplate(stackKey, options.region),
      );
      if (finalHash !== candidateTemplateSha256) {
        throw new Error(`${stackKey} 실행 후 live template hash가 승인 후보와 다릅니다.`);
      }
      process.stdout.write([
        `Stage B ${options.phase}/${stackKey} exact change set 실행 완료`,
        `PROVENANCE_SHA256=${provenance.digest}`,
        `${stackKey.toUpperCase()}_LIVE_TEMPLATE_SHA256=${finalHash}`,
        "",
      ].join("\n"));
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (shouldReleaseStageBInfrastructureLease({
        leaseAcquired,
        executionMayHaveStarted,
        executionTerminalKnown,
      })) {
        try {
          await releaseEditorRenderV4InfrastructureLease({
            owner: leaseOwner,
            leaseId,
          });
        } catch (releaseError) {
          if (!primaryError) throw releaseError;
          process.stderr.write(
            `Stage B lease 해제 실패(만료 후 자동 복구): ${releaseError instanceof Error ? releaseError.message : String(releaseError)}\n`,
          );
        }
      } else if (leaseAcquired) {
        process.stderr.write(
          "Stage B 실행 terminal 상태가 불명확해 lease를 명시적으로 해제하지 않습니다. 2시간 TTL 동안 신규 v4 admission과 관리 전환은 계속 차단됩니다.\n",
        );
      }
    }
  } finally {
    fs.rmSync(synthesized.outputDirectory, { recursive: true, force: true });
  }
}

export async function runStageBReleaseControl(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const initial = repositoryState(options);
  const registry = readProductionProjectTargets();
  verifyPromotedProductionBaseline(options.base);
  await verifyStageBDatabaseContracts({
    requireStopped: options.phase !== "lockdown",
  });

  if (options.mode === "execute") {
    await executeChangeSet(options, initial, registry);
    return;
  }

  const identity = productionIdentity(registry, options.region);
  const validationOptions = verifierOptions(options, registry, identity);
  const stackKeys = stageBStackKeys(options.phase);
  for (const stackKey of stackKeys) liveStack(stackKey, options.region);

  const context = stageBCdkContext(options, registry, validationOptions);
  const contextArgs = Object.entries(context).flatMap(([name, value]) => [
    "-c",
    `${name}=${value}`,
  ]);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-stage-b-control-"));
  const cdkEnvironment = {
    AWS_REGION: options.region,
    AWS_DEFAULT_REGION: options.region,
  };
  const preparedRecords = [];
  let prepareSucceeded = false;
  try {
    run("npm", ["run", "build"], { cwd: infra, env: cdkEnvironment });
    run("npx", [
      "cdk",
      "synth",
      ...stackKeys.map((stackKey) => STAGE_B_STACKS[stackKey].stackName),
      "--quiet",
      "--exclusively",
      "--output",
      outputDirectory,
      ...contextArgs,
    ], { cwd: infra, env: cdkEnvironment });

    const currentTemplates = {};
    const currentHashes = {};
    const exactTemplates = {};
    const candidateHashes = {};
    for (const stackKey of stackKeys) {
      const candidatePath = path.join(
        outputDirectory,
        STAGE_B_STACKS[stackKey].templateFile,
      );
      if (!fs.existsSync(candidatePath)) {
        throw new Error(`${stackKey} 합성 template을 찾을 수 없습니다: ${candidatePath}`);
      }
      const current = liveTemplate(stackKey, options.region);
      const fullCandidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
      const deploymentCandidate = projectExactStageBDeploymentCandidate(
        options.phase,
        stackKey,
        current,
        fullCandidate,
      );
      const exact = buildExactStageBTemplate(
        options.phase,
        stackKey,
        current,
        deploymentCandidate,
        validationOptions,
      );
      fs.writeFileSync(candidatePath, `${JSON.stringify(exact, null, 2)}\n`, "utf8");
      validateExactStageBTemplate(
        options.phase,
        stackKey,
        current,
        exact,
        validationOptions,
      );
      currentTemplates[stackKey] = current;
      currentHashes[stackKey] = stageBTemplateSha256(current);
      exactTemplates[stackKey] = exact;
      candidateHashes[stackKey] = stageBTemplateSha256(exact);
    }

    verifyRepositoryUnchanged(options, initial);
    verifyPromotedProductionBaseline(options.base);
    verifyLiveHashes(stackKeys, options.region, currentHashes);
    process.stdout.write([
      `Stage B ${options.phase} exact template 검사 통과`,
      `HEAD=${initial.head}`,
      `REGISTRY_SHA256=${initial.registrySha256}`,
      ...stackKeys.flatMap((stackKey) => [
        `${stackKey.toUpperCase()}_LIVE_TEMPLATE_SHA256=${currentHashes[stackKey]}`,
        `${stackKey.toUpperCase()}_TEMPLATE_SHA256=${candidateHashes[stackKey]}`,
      ]),
      "",
    ].join("\n"));

    if (options.mode !== "prepare") {
      process.stdout.write("검사 전용입니다. change set 생성은 --prepare를 사용하세요.\n");
      return;
    }

    publishAndVerifyStageBAssets({
      options,
      stackKeys,
      outputDirectory,
      cdkEnvironment,
      currentTemplates,
      exactTemplates,
      identity,
    });
    verifyRepositoryUnchanged(options, initial);
    verifyPromotedProductionBaseline(options.base);
    verifyLiveHashes(stackKeys, options.region, currentHashes);

    for (const stackKey of stackKeys) {
      verifyRepositoryUnchanged(options, initial);
      verifyPromotedProductionBaseline(options.base);
      verifyLiveHashes(stackKeys, options.region, currentHashes);
      const provenance = changeSetProvenance(
        options,
        initial,
        stackKey,
        currentHashes[stackKey],
        candidateHashes[stackKey],
        candidateHashes.editor,
      );
      const name = provenance.changeSetName;
      assertChangeSetNameUnused(stackKey, options.region, name);
      await verifyStageBDatabaseContracts({
        requireStopped: options.phase !== "lockdown",
      });
      const record = { stackKey, name, id: "", provenance };
      preparedRecords.push(record);
      const prepared = prepareChangeSet(
        options,
        stackKey,
        outputDirectory,
        name,
        candidateHashes[stackKey],
        exactTemplates[stackKey],
        currentTemplates[stackKey],
        validationOptions,
        identity,
      );
      record.id = prepared.ChangeSetId;
      assertChangeSetProvenance(prepared, name, record.id);
    }
    verifyRepositoryUnchanged(options, initial);
    verifyPromotedProductionBaseline(options.base);
    verifyLiveHashes(stackKeys, options.region, currentHashes);
    prepareSucceeded = true;
    process.stdout.write([
      `Stage B ${options.phase} 검토용 change set 준비 완료`,
      ...preparedRecords.flatMap((record) => [
        `${record.stackKey.toUpperCase()}_CHANGE_SET_ID=${record.id}`,
        `${record.stackKey.toUpperCase()}_CHANGE_SET_NAME=${record.name}`,
        `${record.stackKey.toUpperCase()}_PROVENANCE_SHA256=${record.provenance.digest}`,
        `${record.stackKey.toUpperCase()}_EXPECTED_LIVE_TEMPLATE_SHA256=${currentHashes[record.stackKey]}`,
        `${record.stackKey.toUpperCase()}_EXPECTED_TEMPLATE_SHA256=${candidateHashes[record.stackKey]}`,
        `${record.stackKey.toUpperCase()}_EXPECTED_EDITOR_TEMPLATE_SHA256=${candidateHashes.editor}`,
      ]),
      options.phase === "lockdown"
        ? "자동 실행하지 않았습니다. IAM-only Editor preview/해시를 검토한 뒤 별도로 실행하세요."
        : options.phase === "renewal"
          ? "자동 실행하지 않았습니다. renewal은 exact Editor preview/해시만 검토한 뒤 별도로 실행하세요."
          : "자동 실행하지 않았습니다. Editor preview/해시를 먼저 검토·실행한 뒤 Compute를 별도로 실행하세요.",
      "",
    ].join("\n"));
  } finally {
    if (options.mode === "prepare" && !prepareSucceeded && preparedRecords.length) {
      cleanupPreparedChangeSets(options.region, preparedRecords);
    }
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runStageBReleaseControl().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
