import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./register-editor-v4-project-lane.sh", import.meta.url),
);
const source = await readFile(scriptPath, "utf8");
const region = "ap-northeast-2";
const accountId = "181651591905";
const gitSha = "c".repeat(40);
const imageDigest = `sha256:${"d".repeat(64)}`;
const fontHash = "e".repeat(64);
const repositoryUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/shorts-mvp-editor-releases-production`;
const templateArn = `arn:aws:batch:${region}:${accountId}:job-definition/shorts-mvp-source-range-ccccccc-production:7`;
const candidateArn = `arn:aws:batch:${region}:${accountId}:job-definition/shorts-mvp-editor-v4-source-range-${gitSha.slice(0, 12)}:1`;

function template() {
  return {
    jobDefinitionArn: templateArn,
    jobDefinitionName: "shorts-mvp-source-range-ccccccc-production",
    status: "ACTIVE",
    revision: 7,
    type: "container",
    parameters: { retained: "true" },
    platformCapabilities: ["FARGATE"],
    retryStrategy: { attempts: 1 },
    timeout: { attemptDurationSeconds: 7200 },
    propagateTags: true,
    tags: {
      Existing: "preserved",
      ReleaseSha: "a".repeat(40),
      WorkerImageDigest: `sha256:${"a".repeat(64)}`,
      RenderSpecVersion: "3",
      "aws:cloudformation:stack-name": "removed",
    },
    containerProperties: {
      image: `${repositoryUri}@sha256:${"a".repeat(64)}`,
      command: ["python", "-m", "shorts_worker", "project"],
      environment: [
        { name: "UNCHANGED", value: "preserved" },
        { name: "WORKER_IMAGE_TAG", value: "old" },
        { name: "WORKER_IMAGE_DIGEST", value: "old" },
        { name: "EDITOR_RENDER_SPEC_VERSION", value: "3" },
      ],
      resourceRequirements: [
        { type: "VCPU", value: "8" },
        { type: "MEMORY", value: "16384" },
      ],
      ephemeralStorage: { sizeInGiB: 30 },
    },
  };
}

async function runRegistration(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "editor-v4-lane-test-"));
  const binDirectory = join(directory, "bin");
  const templatePath = join(directory, "template.json");
  const capturePath = join(directory, "registered.json");
  await mkdir(binDirectory);
  await writeFile(templatePath, JSON.stringify(template()));
  const awsPath = join(binDirectory, "aws");
  await writeFile(awsPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "batch" && "$2" == "describe-job-definitions" ]]; then
  if [[ " $* " == *" --job-definition-name "* ]]; then
    printf 'None\\n'
  else
    cat "$MOCK_TEMPLATE_JSON"
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
  const result = spawnSync("bash", [scriptPath, "source_range", templateArn], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      AWS_REGION: region,
      EDITOR_RELEASE_ECR_REPOSITORY_URI: repositoryUri,
      EDITOR_RELEASE_GIT_SHA: gitSha,
      EDITOR_RELEASE_IMAGE_DIGEST: imageDigest,
      EDITOR_RELEASE_RENDER_SPEC_VERSION: "4",
      EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION: "4",
      EDITOR_RELEASE_FONT_MANIFEST_SHA256: fontHash,
      MOCK_TEMPLATE_JSON: templatePath,
      MOCK_REGISTER_CAPTURE: capturePath,
      MOCK_CANDIDATE_ARN: candidateArn,
      ...overrides,
    },
  });
  let registered = null;
  try {
    registered = JSON.parse(await readFile(capturePath, "utf8"));
  } catch {
    // Validation failures intentionally stop before registration.
  }
  await rm(directory, { recursive: true, force: true });
  return { registered, result };
}

test("clones one lane at the exact digest and replaces release identity tags", async () => {
  const { registered, result } = await runRegistration();
  assert.equal(result.status, 0, result.stderr);
  assert.match(source, /echo "job_definition_arn=\$registered_arn"/);
  assert.match(source, /echo "batch_target_release_id=\$release_id"/);
  assert.ok(registered);
  assert.equal(registered.containerProperties.image, `${repositoryUri}@${imageDigest}`);
  assert.deepEqual(registered.parameters, { retained: "true" });
  assert.deepEqual(registered.containerProperties.resourceRequirements, [
    { type: "VCPU", value: "8" },
    { type: "MEMORY", value: "16384" },
  ]);
  assert.deepEqual(registered.tags, {
    Existing: "preserved",
    ReleaseSha: gitSha,
    WorkerImageDigest: imageDigest,
    RenderSpecVersion: "4",
    CaptionRenderSpecVersion: "4",
    FontManifestSha256: fontHash,
  });
  assert.deepEqual(
    Object.fromEntries(registered.containerProperties.environment.map(
      ({ name, value }) => [name, value],
    )),
    {
      UNCHANGED: "preserved",
      WORKER_IMAGE_TAG: imageDigest,
      WORKER_IMAGE_DIGEST: imageDigest,
      EDITOR_RELEASE_GIT_SHA: gitSha,
      EDITOR_RENDER_SPEC_VERSION: "4",
      EDITOR_CAPTION_RENDER_SPEC_VERSION: "4",
      EDITOR_FONT_MANIFEST_SHA256: fontHash,
    },
  );
});

test("fails closed before AWS when the v4 capability triple is not exact", async () => {
  const { registered, result } = await runRegistration({
    EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION: "3",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exact 4\/4 render capability/);
  assert.equal(registered, null);
});

test("never mutates queues or rebuilds the tested image", () => {
  assert.doesNotMatch(
    source,
    /(?:create|update)-job-queue|update-compute-environment|docker\s+(?:build|push)/,
  );
});
