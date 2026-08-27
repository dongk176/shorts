import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("./register-unified-source-range-job.sh", import.meta.url));
const source = await readFile(scriptPath, "utf8");
const account = "181651591905";
const region = "ap-northeast-2";
const sha = "f28e1fe874c1bff1da6184088ef1ee48e8418dc5";
const digest = `sha256:${"f".repeat(64)}`;
const repository = `${account}.dkr.ecr.${region}.amazonaws.com/shorts-mvp-editor-releases-production`;
const unifiedArn = `arn:aws:batch:${region}:${account}:job-definition/unified-old:4`;
const sourceRangeArn = `arn:aws:batch:${region}:${account}:job-definition/source-range:1`;
const candidateName = `shorts-mvp-unified-source-range-${sha.slice(0, 12)}-8vcpu`;
const candidateArn = `arn:aws:batch:${region}:${account}:job-definition/${candidateName}:1`;

function definition({ name, arn, image, vcpus, ephemeral, timeout, environment, secrets }) {
  return {
    jobDefinitionArn: arn,
    jobDefinitionName: name,
    revision: 1,
    status: "ACTIVE",
    type: "container",
    parameters: {},
    platformCapabilities: ["FARGATE"],
    retryStrategy: { attempts: 1 },
    timeout: { attemptDurationSeconds: timeout },
    propagateTags: true,
    tags: { Existing: "preserved" },
    containerProperties: {
      image,
      ephemeralStorage: { sizeInGiB: ephemeral },
      resourceRequirements: [
        { type: "VCPU", value: String(vcpus) },
        { type: "MEMORY", value: "16384" },
      ],
      environment,
      secrets,
    },
  };
}

function fixtures() {
  const unified = definition({
    name: "unified-old",
    arn: unifiedArn,
    image: `${repository}@${digest}`,
    vcpus: 4,
    ephemeral: 30,
    timeout: 7200,
    environment: [
      { name: "PROJECT_RESOURCE_TIER", value: "heavy" },
      { name: "TASK_VCPUS", value: "4" },
      { name: "FFMPEG_THREADS", value: "4" },
      { name: "UNCHANGED", value: "preserved" },
    ],
    secrets: [
      { name: "DATABASE_URL", valueFrom: "secret:db" },
      { name: "INGESTION_PROXY_ROUTES_JSON", valueFrom: "secret:proxy" },
      { name: "ELEVENLABS_API_KEY", valueFrom: "secret:elevenlabs" },
    ],
  });
  const range = definition({
    name: "source-range",
    arn: sourceRangeArn,
    image: `${repository}@sha256:${"a".repeat(64)}`,
    vcpus: 8,
    ephemeral: 80,
    timeout: 18000,
    environment: [
      { name: "MAX_VIDEO_DURATION_SECONDS", value: "14400" },
      { name: "DOWNLOAD_TIMEOUT_SECONDS", value: "14400" },
      { name: "PROJECT_RESOURCE_TIER", value: "source_range" },
      { name: "TASK_VCPUS", value: "8" },
      { name: "FFMPEG_THREADS", value: "2" },
    ],
    secrets: [{ name: "INGESTION_PROXY_ROUTES_JSON", valueFrom: "secret:proxy" }],
  });
  return { unified, range };
}

async function runRegistration({ mutate } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "unified-source-range-test-"));
  const bin = join(directory, "bin");
  const capture = join(directory, "register.json");
  const unifiedPath = join(directory, "unified.json");
  const rangePath = join(directory, "range.json");
  await mkdir(bin);
  const values = fixtures();
  mutate?.(values);
  await writeFile(unifiedPath, JSON.stringify(values.unified));
  await writeFile(rangePath, JSON.stringify(values.range));
  const awsPath = join(bin, "aws");
  await writeFile(awsPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "batch" && "$2" == "describe-job-definitions" ]]; then
  if [[ " $* " == *" --job-definition-name "* ]]; then
    printf 'None\\n'
  elif [[ " $* " == *" $MOCK_UNIFIED_ARN "* ]]; then
    cat "$MOCK_UNIFIED_JSON"
  elif [[ " $* " == *" $MOCK_RANGE_ARN "* ]]; then
    cat "$MOCK_RANGE_JSON"
  elif [[ " $* " == *" $MOCK_CANDIDATE_ARN "* ]]; then
    jq --arg arn "$MOCK_CANDIDATE_ARN" '. + {jobDefinitionArn:$arn,status:"ACTIVE",revision:1}' "$MOCK_CAPTURE"
  else
    exit 64
  fi
elif [[ "$1" == "batch" && "$2" == "register-job-definition" ]]; then
  for argument in "$@"; do
    [[ "$argument" == file://* ]] && cp "\${argument#file://}" "$MOCK_CAPTURE"
  done
  printf '%s\\n' "$MOCK_CANDIDATE_ARN"
else
  exit 64
fi
`);
  await chmod(awsPath, 0o755);
  const result = spawnSync("bash", [scriptPath, unifiedArn, sourceRangeArn], {
    cwd: dirname(scriptPath),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AWS_REGION: region,
      UNIFIED_SOURCE_RANGE_ECR_REPOSITORY_URI: repository,
      UNIFIED_SOURCE_RANGE_GIT_SHA: sha,
      UNIFIED_SOURCE_RANGE_IMAGE_DIGEST: digest,
      MOCK_UNIFIED_ARN: unifiedArn,
      MOCK_RANGE_ARN: sourceRangeArn,
      MOCK_CANDIDATE_ARN: candidateArn,
      MOCK_UNIFIED_JSON: unifiedPath,
      MOCK_RANGE_JSON: rangePath,
      MOCK_CAPTURE: capture,
    },
  });
  const registered = await readFile(capture, "utf8").then(JSON.parse).catch(() => null);
  await rm(directory, { recursive: true, force: true });
  return { result, registered };
}

test("creates only an additive 8-vCPU combined definition", () => {
  assert.doesNotMatch(source, /(?:create|update)-job-queue|update-compute-environment|deregister-job-definition|cdk deploy/);
  assert.match(source, /unified-source-range-\$\{git_sha:0:12\}-8vcpu/);
});

test("preserves subtitle secrets and applies the proven 4-hour range contract", async () => {
  const { result, registered } = await runRegistration();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`job_definition_arn=${candidateArn}`));
  assert.equal(registered.containerProperties.ephemeralStorage.sizeInGiB, 80);
  assert.equal(registered.timeout.attemptDurationSeconds, 18000);
  assert.deepEqual(registered.containerProperties.resourceRequirements, [
    { type: "VCPU", value: "8" },
    { type: "MEMORY", value: "16384" },
  ]);
  const environment = Object.fromEntries(registered.containerProperties.environment.map(({ name, value }) => [name, value]));
  assert.equal(environment.MAX_VIDEO_DURATION_SECONDS, "14400");
  assert.equal(environment.PROJECT_RESOURCE_TIER, "source_range");
  assert.equal(environment.UNCHANGED, "preserved");
  assert.ok(registered.containerProperties.secrets.some(({ name }) => name === "ELEVENLABS_API_KEY"));
});

test("fails closed before registration when either trusted contract is incomplete", async () => {
  const { result, registered } = await runRegistration({
    mutate: ({ unified }) => {
      unified.containerProperties.secrets = unified.containerProperties.secrets
        .filter(({ name }) => name !== "ELEVENLABS_API_KEY");
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /trusted subtitle worker contract/);
  assert.equal(registered, null);
});
