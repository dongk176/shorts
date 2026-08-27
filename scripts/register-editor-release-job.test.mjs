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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./register-editor-release-job.sh", import.meta.url),
);
const source = await readFile(scriptPath, "utf8");

const accountId = "181651591905";
const region = "ap-northeast-2";
const templateName = "shorts-mvp-project-heavy-fargate-production";
const templateArn = `arn:aws:batch:${region}:${accountId}:job-definition/${templateName}:27`;
const releaseSha = "c".repeat(40);
const candidateName = `shorts-mvp-unified-template-subtitles-${releaseSha.slice(0, 12)}-4vcpu`;
const candidateArn = `arn:aws:batch:${region}:${accountId}:job-definition/${candidateName}:1`;
const repositoryUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/shorts-mvp-editor-releases-production`;
const imageDigest = `sha256:${"d".repeat(64)}`;
const capabilityEnvironmentNames = [
  "EDITOR_RELEASE_RENDER_SPEC_VERSION",
  "EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION",
  "EDITOR_RELEASE_FONT_MANIFEST_SHA256",
];

function isolatedRegistrationEnvironment(baseEnvironment, overrides) {
  const environment = { ...baseEnvironment };
  for (const name of capabilityEnvironmentNames) {
    delete environment[name];
  }
  return { ...environment, ...overrides };
}

function projectHeavyTemplate() {
  return {
    jobDefinitionArn: templateArn,
    jobDefinitionName: templateName,
    revision: 27,
    status: "ACTIVE",
    type: "container",
    parameters: {},
    platformCapabilities: ["FARGATE"],
    retryStrategy: { attempts: 1 },
    timeout: { attemptDurationSeconds: 7200 },
    propagateTags: true,
    tags: { Existing: "preserved", "aws:cloudformation:stack-name": "removed" },
    containerProperties: {
      image: `${repositoryUri}@sha256:${"a".repeat(64)}`,
      ephemeralStorage: { sizeInGiB: 30 },
      resourceRequirements: [
        { type: "VCPU", value: "8" },
        { type: "MEMORY", value: "16384" },
      ],
      environment: [
        { name: "TASK_VCPUS", value: "8" },
        { name: "FFMPEG_THREADS", value: "2" },
        { name: "PROJECT_RESOURCE_TIER", value: "heavy" },
        { name: "WORKER_IMAGE_TAG", value: "old" },
        { name: "UNCHANGED", value: "preserved" },
      ],
      secrets: [
        { name: "DATABASE_URL", valueFrom: "secret:database" },
        {
          name: "INGESTION_PROXY_ROUTES_JSON",
          valueFrom: "secret:proxy-routes",
        },
      ],
    },
  };
}

async function runRegistration(template, templateDefinition = templateName) {
  const directory = await mkdtemp(join(tmpdir(), "editor-release-job-test-"));
  const binDirectory = join(directory, "bin");
  const templatePath = join(directory, "template.json");
  const capturePath = join(directory, "registered-input.json");
  const awsPath = join(binDirectory, "aws");
  await mkdir(binDirectory);
  await writeFile(templatePath, JSON.stringify(template));
  await writeFile(awsPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "batch" && "$2" == "describe-job-definitions" ]]; then
  if [[ " $* " == *" --job-definition-name "* ]]; then
    printf 'None\\n'
  elif [[ " $* " == *" $MOCK_TEMPLATE_DEFINITION "* ]]; then
    cat "$MOCK_TEMPLATE_JSON"
  elif [[ " $* " == *" $MOCK_CANDIDATE_ARN "* ]]; then
    jq --arg arn "$MOCK_CANDIDATE_ARN" \\
      '. + {jobDefinitionArn:$arn,status:"ACTIVE",revision:1}' \\
      "$MOCK_REGISTER_CAPTURE"
  else
    echo "unexpected describe invocation: $*" >&2
    exit 64
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
    "unified-template-subtitles",
    templateDefinition,
  ], {
    cwd: dirname(scriptPath),
    encoding: "utf8",
    env: isolatedRegistrationEnvironment(process.env, {
      PATH: `${binDirectory}:${process.env.PATH}`,
      AWS_REGION: region,
      EDITOR_RELEASE_ECR_REPOSITORY_URI: repositoryUri,
      EDITOR_RELEASE_GIT_SHA: releaseSha,
      EDITOR_RELEASE_IMAGE_DIGEST: imageDigest,
      MOCK_TEMPLATE_DEFINITION: templateDefinition,
      MOCK_TEMPLATE_JSON: templatePath,
      MOCK_CANDIDATE_ARN: candidateArn,
      MOCK_REGISTER_CAPTURE: capturePath,
    }),
  });
  let registered = null;
  try {
    registered = JSON.parse(await readFile(capturePath, "utf8"));
  } catch {
    // Contract failures stop before registration and intentionally create no capture.
  }
  await rm(directory, { recursive: true, force: true });
  return { registered, result };
}

test("adds a separate deterministic kind without creating or updating queues", () => {
  assert.match(source, /unified-template-subtitles\)/);
  assert.match(
    source,
    /shorts-mvp-unified-template-subtitles-\$\{git_sha:0:12\}-4vcpu/,
  );
  assert.match(source, /shorts-mvp-project-heavy-fargate-production/);
  assert.doesNotMatch(
    source,
    /(?:create|update)-job-queue|update-compute-environment|cdk deploy/,
  );
});

test("does not inherit an incomplete workflow capability contract", () => {
  const environment = isolatedRegistrationEnvironment(
    {
      KEEP_ME: "yes",
      EDITOR_RELEASE_RENDER_SPEC_VERSION: "4",
      EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION: "4",
    },
    { AWS_REGION: region },
  );

  assert.equal(environment.KEEP_ME, "yes");
  assert.equal(environment.AWS_REGION, region);
  for (const name of capabilityEnvironmentNames) {
    assert.equal(Object.hasOwn(environment, name), false);
  }
});

test("clones the project-heavy initial-render contract at the tested digest", async () => {
  const { registered, result } = await runRegistration(projectHeavyTemplate());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`job_definition_arn=${candidateArn}`));
  assert.match(
    result.stdout,
    new RegExp(`unified_template_subtitles_job_definition_arn=${candidateArn}`),
  );
  assert.ok(registered);
  assert.equal(registered.jobDefinitionName, candidateName);
  assert.equal(registered.containerProperties.image, `${repositoryUri}@${imageDigest}`);
  assert.deepEqual(registered.containerProperties.ephemeralStorage, {
    sizeInGiB: 30,
  });
  assert.equal(registered.timeout.attemptDurationSeconds, 7200);
  assert.deepEqual(registered.containerProperties.resourceRequirements, [
    { type: "MEMORY", value: "16384" },
    { type: "VCPU", value: "4" },
  ]);
  assert.equal(
    registered.containerProperties.secrets.filter(
      ({ name }) => name === "INGESTION_PROXY_ROUTES_JSON",
    ).length,
    1,
  );
  assert.deepEqual(
    Object.fromEntries(registered.containerProperties.environment.map(
      ({ name, value }) => [name, value],
    )),
    {
      PROJECT_RESOURCE_TIER: "heavy",
      UNCHANGED: "preserved",
      WORKER_IMAGE_TAG: imageDigest,
      WORKER_IMAGE_DIGEST: imageDigest,
      TASK_VCPUS: "4",
      FFMPEG_THREADS: "4",
    },
  );
  assert.deepEqual(registered.tags, {});
});

test("accepts only the production project-heavy name or its revision-pinned ARN", async () => {
  const exact = await runRegistration(projectHeavyTemplate(), templateArn);
  assert.equal(exact.result.status, 0, exact.result.stderr);

  const rejected = await runRegistration(
    projectHeavyTemplate(),
    "shorts-mvp-rerender-fargate-production",
  );
  assert.equal(rejected.result.status, 2);
  assert.match(rejected.result.stderr, /production project-heavy Job Definition/);
  assert.equal(rejected.registered, null);
});

test("fails closed when proxy, 30GB storage, or 7200-second timeout is missing", async () => {
  for (const mutate of [
    (template) => {
      template.containerProperties.secrets = [];
    },
    (template) => {
      template.containerProperties.ephemeralStorage.sizeInGiB = 20;
    },
    (template) => {
      template.timeout.attemptDurationSeconds = 1200;
    },
  ]) {
    const template = projectHeavyTemplate();
    mutate(template);
    const { registered, result } = await runRegistration(template);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /trusted project-heavy contract/);
    assert.equal(registered, null);
  }
});
