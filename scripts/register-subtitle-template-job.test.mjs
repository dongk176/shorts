import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./register-subtitle-template-job.sh", import.meta.url),
);
const source = await readFile(
  scriptPath,
  "utf8",
);

const templateArn = "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitle-template:1";
const candidateArn = "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitle-candidate:1";
const oldDigest = `sha256:${"a".repeat(64)}`;
const newDigest = `sha256:${"b".repeat(64)}`;
const releaseSha = "c".repeat(40);

function trustedTemplate() {
  return {
    jobDefinitions: [{
      jobDefinitionArn: templateArn,
      status: "ACTIVE",
      type: "container",
      parameters: {},
      containerProperties: {
        image: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@${oldDigest}`,
        resourceRequirements: [
          { type: "VCPU", value: "8" },
          { type: "MEMORY", value: "16384" },
        ],
        environment: [
          { name: "TASK_VCPUS", value: "8" },
          { name: "FFMPEG_THREADS", value: "2" },
          { name: "WORKER_IMAGE_TAG", value: "stale-tag" },
          { name: "WORKER_IMAGE_DIGEST", value: oldDigest },
          { name: "UNCHANGED", value: "preserved" },
        ],
      },
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 3600 },
      platformCapabilities: ["FARGATE"],
      propagateTags: true,
      tags: { Existing: "preserved" },
    }],
  };
}

async function runRegistration(template) {
  const directory = await mkdtemp(join(tmpdir(), "subtitle-registration-test-"));
  const binDirectory = join(directory, "bin");
  const templatePath = join(directory, "template.json");
  const capturePath = join(directory, "registered-input.json");
  const awsPath = join(binDirectory, "aws");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(binDirectory));
  await writeFile(templatePath, JSON.stringify(template));
  await writeFile(awsPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "batch" && "$2" == "describe-job-definitions" ]]; then
  if [[ " $* " == *" $MOCK_TEMPLATE_ARN "* ]]; then
    cat "$MOCK_TEMPLATE_JSON"
  else
    jq --arg arn "$MOCK_CANDIDATE_ARN" \
      '. + {jobDefinitionArn:$arn,status:"ACTIVE"} | {jobDefinitions:[.]}' \
      "$MOCK_REGISTER_CAPTURE"
  fi
elif [[ "$1" == "batch" && "$2" == "register-job-definition" ]]; then
  for argument in "$@"; do
    if [[ "$argument" == file://* ]]; then
      cp "\${argument#file://}" "$MOCK_REGISTER_CAPTURE"
    fi
  done
  printf '%s\\n' "$MOCK_CANDIDATE_ARN"
else
  echo "unexpected aws invocation: $*" >&2
  exit 64
fi
`);
  await chmod(awsPath, 0o755);
  const result = spawnSync("bash", [
    scriptPath,
    templateArn,
    newDigest,
    releaseSha,
  ], {
    cwd: dirname(scriptPath),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      MOCK_TEMPLATE_ARN: templateArn,
      MOCK_CANDIDATE_ARN: candidateArn,
      MOCK_TEMPLATE_JSON: templatePath,
      MOCK_REGISTER_CAPTURE: capturePath,
    },
  });
  let registered = null;
  try {
    registered = JSON.parse(await readFile(capturePath, "utf8"));
  } catch {
    // Validation failures intentionally stop before registration.
  }
  await rm(directory, { recursive: true, force: true });
  return { result, registered };
}

test("subtitle candidate registration clones only an immutable job definition", () => {
  assert.match(source, /describe-job-definitions/);
  assert.match(source, /register-job-definition/);
  assert.match(source, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(source, /subtitle-templates-\$\{release_sha:0:12\}/);
  assert.doesNotMatch(source, /cdk deploy|update-compute-environment|update-job-queue/);
});

test("subtitle candidate keeps the trusted resource contract and replaces image identity", () => {
  assert.match(source, /template Job Definition image is not pinned by digest/);
  assert.match(source, /repository_reference="\$\{template_image%@\*\}"/);
  assert.match(source, /repository_name="\$\{repository_name%%:\*\}"/);
  assert.match(source, /repository_uri="\$\{repository_prefix\}\/\$\{repository_name\}"/);
  assert.match(source, /WORKER_IMAGE_TAG/);
  assert.match(source, /WORKER_IMAGE_DIGEST/);
  assert.match(source, /registered subtitle Job Definition identity verification failed/);
  assert.match(source, /ascii_downcase \| startswith\("aws:"\)/);
  assert.match(source, /Purpose: "subtitle-templates-admin-canary"/);
});

test("subtitle candidate rewrites tag and digest while preserving the 8-vCPU contract", async () => {
  const { result, registered } = await runRegistration(trustedTemplate());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), candidateArn);
  assert.ok(registered);
  assert.equal(
    registered.containerProperties.image,
    `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@${newDigest}`,
  );
  assert.deepEqual(registered.containerProperties.resourceRequirements, [
    { type: "VCPU", value: "8" },
    { type: "MEMORY", value: "16384" },
  ]);
  assert.deepEqual(
    Object.fromEntries(registered.containerProperties.environment.map(
      ({ name, value }) => [name, value],
    )),
    {
      TASK_VCPUS: "8",
      FFMPEG_THREADS: "2",
      WORKER_IMAGE_TAG: newDigest,
      WORKER_IMAGE_DIGEST: newDigest,
      UNCHANGED: "preserved",
    },
  );
});

test("subtitle candidate fails closed when image identity entries are absent or duplicated", async () => {
  const missing = trustedTemplate();
  missing.jobDefinitions[0].containerProperties.environment = missing.jobDefinitions[0]
    .containerProperties.environment.filter(({ name }) => name !== "WORKER_IMAGE_DIGEST");
  const missingResult = await runRegistration(missing);
  assert.equal(missingResult.result.status, 2);
  assert.match(missingResult.result.stderr, /trusted 8-vCPU subtitle contract/);
  assert.equal(missingResult.registered, null);

  const duplicated = trustedTemplate();
  duplicated.jobDefinitions[0].containerProperties.environment.push({
    name: "WORKER_IMAGE_TAG",
    value: "duplicate",
  });
  const duplicateResult = await runRegistration(duplicated);
  assert.equal(duplicateResult.result.status, 2);
  assert.match(duplicateResult.result.stderr, /trusted 8-vCPU subtitle contract/);
  assert.equal(duplicateResult.registered, null);
});
