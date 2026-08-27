import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readProductionWorkerRelease } from "./production-worker-release.mjs";
import {
  validateLambdaRegistryConfiguration,
  parseArgs,
  validatePreviousDefinitions,
  readReleasedWorkerSources,
  registryEcrImageRequirements,
  validateRegistryEcrImages,
  validateRegistryQueueScheduling,
  validateRegistryAsset,
  validateReleasedDefinitions,
  validateWorkerAttemptBudget,
} from "./verify-production-worker-release.mjs";
import { readProductionProjectTargets } from "./production-project-targets.mjs";
import {
  projectBatchTargets,
  PROJECT_TARGET_PREFIXES,
} from "./verify-project-batch-targets.mjs";
import { productionWorkerEnvironment } from "./production-worker-release.mjs";

const release = readProductionWorkerRelease();
const registry = readProductionProjectTargets();
const targets = projectBatchTargets(
  productionWorkerEnvironment(release),
  PROJECT_TARGET_PREFIXES,
);

test("requires every current lane to use its exact registered immutable digest", () => {
  const registeredByDefinition = new Map(
    Object.values(registry.lanes).map((lane) => [
      lane.current.jobDefinitionArn,
      lane.current,
    ]),
  );
  const definitions = Object.values(targets).map(({ definition }) => ({
    jobDefinitionArn: definition,
    status: "ACTIVE",
    ...(definition === targets.UNIFIED_TEMPLATE_SUBTITLES.definition
      ? { timeout: { attemptDurationSeconds: 18000 } }
      : {}),
    containerProperties: {
      image: registeredByDefinition.get(definition).imageUri,
      ...(definition === targets.UNIFIED_TEMPLATE_SUBTITLES.definition
        ? {
          ephemeralStorage: { sizeInGiB: 80 },
          resourceRequirements: [
            { type: "VCPU", value: "8" },
            { type: "MEMORY", value: "16384" },
          ],
          environment: [
            { name: "MAX_VIDEO_DURATION_SECONDS", value: "14400" },
            { name: "DOWNLOAD_TIMEOUT_SECONDS", value: "14400" },
            { name: "PROJECT_RESOURCE_TIER", value: "source_range" },
            { name: "TASK_VCPUS", value: "8" },
            { name: "FFMPEG_THREADS", value: "2" },
          ],
          secrets: [
            { name: "INGESTION_PROXY_ROUTES_JSON", valueFrom: "secret:proxy" },
            { name: "ELEVENLABS_API_KEY", valueFrom: "secret:elevenlabs" },
          ],
        }
        : {}),
    },
    retryStrategy: { attempts: 1 },
  }));
  const queues = [...new Set(Object.values(targets).map(({ queue }) => queue))]
    .map((jobQueueArn) => ({ jobQueueArn, status: "VALID", state: "ENABLED" }));
  assert.doesNotThrow(
    () => validateReleasedDefinitions(
      release,
      registry,
      targets,
      definitions,
      queues,
    ),
  );
  assert.throws(
    () => validateReleasedDefinitions(
      release,
      registry,
      targets,
      definitions.map((row, index) => index === 0
        ? { ...row, containerProperties: { image: "repo.invalid/worker:latest" } }
        : row),
      queues,
    ),
    /image digest 불일치/,
  );
  assert.throws(
    () => validateReleasedDefinitions(
      release,
      registry,
      targets,
      definitions.map((row) => row.jobDefinitionArn === targets.UNIFIED_TEMPLATE_SUBTITLES.definition
        ? {
          ...row,
          containerProperties: {
            ...row.containerProperties,
            image: "repo.invalid/worker:latest",
          },
        }
        : row),
      queues,
    ),
    /image digest 불일치/,
  );
});

test("requires previous releases to stay immutable and single-attempt without conflating generations", () => {
  const previousTargets = [{
    releaseId: "unified-previous-r1",
    jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/unified-previous:1",
    imageUri: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }];
  const previousDefinitions = [{
    jobDefinitionArn: previousTargets[0].jobDefinitionArn,
    containerProperties: {
      image: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    retryStrategy: { attempts: 1 },
  }];
  assert.doesNotThrow(() => validatePreviousDefinitions(
    release,
    previousTargets,
    previousDefinitions,
  ));
  assert.throws(() => validatePreviousDefinitions(
    release,
    previousTargets,
    [{
      ...previousDefinitions[0],
      containerProperties: { image: "repo.invalid/worker:latest" },
    }],
  ), /registry의 immutable digest/);
  assert.throws(() => validatePreviousDefinitions(
    release,
    previousTargets,
    [{
      ...previousDefinitions[0],
      containerProperties: {
        image: "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/untrusted-production@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    }],
  ), /registry의 immutable digest/);
});

test("requires every current and previous registry image digest to exist in ECR", () => {
  const requirements = registryEcrImageRequirements(registry);
  const responses = Object.fromEntries(requirements.map((requirement) => [
    `${requirement.accountId}:${requirement.region}:${requirement.repositoryName}`,
    {
      images: requirement.imageDigests.map((imageDigest) => ({
        imageId: { imageDigest },
      })),
      failures: [],
    },
  ]));
  assert.doesNotThrow(() => validateRegistryEcrImages(
    requirements,
    responses,
    "ap-northeast-2",
  ));

  const missing = structuredClone(responses);
  const first = requirements[0];
  missing[`${first.accountId}:${first.region}:${first.repositoryName}`].images.shift();
  assert.throws(
    () => validateRegistryEcrImages(requirements, missing, "ap-northeast-2"),
    /ECR에 없습니다/,
  );
  assert.throws(
    () => validateRegistryEcrImages(requirements, responses, "us-west-2"),
    /registry region/,
  );
});

test("matches every current and previous queue to the registry scheduling mode", () => {
  const registry = readProductionProjectTargets();
  const queues = [...new Set(Object.values(registry.lanes).flatMap((lane) => (
    [lane.current, lane.previous].filter(Boolean).map((target) => target.jobQueueArn)
  )))].map((jobQueueArn) => ({
    jobQueueArn,
    schedulingPolicyArn: jobQueueArn.endsWith("shorts-mvp-prepare-production")
      ? undefined
      : "arn:aws:batch:ap-northeast-2:181651591905:scheduling-policy/fair",
  }));
  assert.doesNotThrow(() => validateRegistryQueueScheduling(registry, queues));
  assert.throws(
    () => validateRegistryQueueScheduling(registry, queues.map((row) => (
      row.jobQueueArn.endsWith("shorts-mvp-prepare-production")
        ? { ...row, schedulingPolicyArn: "arn:aws:batch:ap-northeast-2:181651591905:scheduling-policy/wrong" }
        : row
    ))),
    /FIFO queue/,
  );
});

test("checks both internal retry ceilings against the release budget", () => {
  assert.doesNotThrow(() => validateWorkerAttemptBudget(
    "MAX_ACQUISITION_ATTEMPTS = 20\n",
    "    MAX_INLINE_INGESTION_ROUTES = 20\n",
  ));
  assert.throws(() => validateWorkerAttemptBudget(
    "MAX_ACQUISITION_ATTEMPTS = 19\n",
    "    MAX_INLINE_INGESTION_ROUTES = 20\n",
  ));
});

test("reads provenance from the immutable release commit without comparing the current worker tree", () => {
  const calls = [];
  const fakeGit = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "show" && args[1].endsWith("ingestion.py")) {
      return "MAX_ACQUISITION_ATTEMPTS = 20\n";
    }
    if (args[0] === "show") return "    MAX_INLINE_INGESTION_ROUTES = 20\n";
    return "";
  };
  const sources = readReleasedWorkerSources(
    "/repo",
    "a".repeat(40),
    fakeGit,
  );
  validateWorkerAttemptBudget(sources.ingestionSource, sources.pipelineSource);
  assert.deepEqual(calls.map((call) => call[1]), ["cat-file", "show", "show"]);
  assert.equal(calls.some((call) => call.includes("diff")), false);

  const verifierSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "verify-production-worker-release.mjs"),
    "utf8",
  );
  assert.doesNotMatch(verifierSource, /\["diff",\s*"--quiet"/);
});

test("supports a resources-only preflight without weakening Batch, ECR, or released-source checks", () => {
  assert.deepEqual(
    parseArgs(["--region", "us-west-2", "--resources-only"]),
    {
      release: "production-worker-release.json",
      lambdaFunction: "shorts-mvp-batch-submitter-production",
      region: "us-west-2",
      resourcesOnly: true,
    },
  );
  const verifierSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "verify-production-worker-release.mjs"),
    "utf8",
  );
  assert.match(
    verifierSource,
    /if \(!options\.resourcesOnly\) \{[\s\S]*get-function-configuration[\s\S]*get-function[\s\S]*validateRegistryAsset/,
  );
  for (const requiredCheck of [
    "validateReleasedDefinitions",
    "validatePreviousDefinitions",
    "validateRegistryQueueScheduling",
    "describe-repositories",
    "batch-get-image",
    "readReleasedWorkerSources",
    "validateWorkerAttemptBudget",
  ]) {
    assert.match(verifierSource, new RegExp(requiredCheck));
  }
});

test("requires one fail-closed registry asset source in production Lambda", () => {
  assert.doesNotThrow(() => validateLambdaRegistryConfiguration({
    PROJECT_TARGET_REGISTRY_REQUIRED: "true",
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
  }));
  assert.throws(() => validateLambdaRegistryConfiguration({
    PROJECT_TARGET_REGISTRY_REQUIRED: "false",
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
  }), /fail-closed/);
  assert.throws(() => validateLambdaRegistryConfiguration({
    PROJECT_TARGET_REGISTRY_REQUIRED: "true",
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    PROJECT_TARGET_REGISTRY_JSON: "{}",
  }), /중복 registry/);
});

test("compares the deployed registry asset byte-for-byte by parsed content", () => {
  const registry = readProductionProjectTargets();
  assert.doesNotThrow(() => validateRegistryAsset(JSON.stringify(registry), registry));
  assert.throws(
    () => validateRegistryAsset(JSON.stringify({ ...registry, version: 2 }), registry),
    /커밋된 registry와 다릅니다/,
  );
});
