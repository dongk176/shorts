import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STAGE_B_DISABLED_EDITOR_RELEASE_REF,
  STAGE_B_EDITOR_RELEASE_REF,
  buildExactStageBTemplate,
  projectExactStageBDeploymentCandidate,
  stageBStackKeys,
  validateAppliedStageBTemplate,
  validateExactStageBTemplate,
  validatePreparedStageBChangeSet,
  validateStageBEditorReleaseRef,
} from "./verify-stage-b-release-control-template-diff.mjs";

const PASS_ROLE_ARNS = [
  "arn:aws:iam::181651591905:role/example-execution",
  "arn:aws:iam::181651591905:role/example-task",
];

const tags = [
  { Key: "Environment", Value: "production" },
  { Key: "ManagedBy", Value: "CDK" },
  { Key: "Project", Value: "shorts-mvp" },
];

function lambda(name, key, environment = {}, overrides = {}) {
  const assetDigit = key.includes("different") ? "d" : (key.includes("new") ? "b" : "a");
  const assetKey = `${assetDigit.repeat(64)}.zip`;
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      FunctionName: name,
      Code: {
        S3Bucket: "cdk-hnb659fds-assets-181651591905-ap-northeast-2",
        S3Key: assetKey,
      },
      Environment: { Variables: environment },
      Handler: overrides.Handler || "handler.handler",
      MemorySize: overrides.MemorySize || 256,
      Role: overrides.Role || { "Fn::GetAtt": ["Role", "Arn"] },
      Runtime: "python3.12",
      Tags: tags,
      Timeout: overrides.Timeout || 60,
    },
    ...(overrides.DependsOn ? { DependsOn: overrides.DependsOn } : {}),
    Metadata: {
      "aws:asset:path": `asset.${assetKey}`,
      "aws:asset:is-bundled": false,
      "aws:cdk:path": `Stack/${name}/Resource`,
    },
  };
}

function arn(suffix) {
  return { "Fn::Join": ["", [
    "arn:", { Ref: "AWS::Partition" }, ":batch:ap-northeast-2:",
    { Ref: "AWS::AccountId" }, `:job-definition/${suffix}`,
  ]] };
}

function exactCondition(ref, verifier = false) {
  return {
    StringEquals: {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": verifier
        ? "repo:dongk176/shorts:environment:editor-v4-release-approval"
        : `repo:dongk176/shorts:ref:${ref}`,
      "token.actions.githubusercontent.com:ref": ref,
      "token.actions.githubusercontent.com:repository": "dongk176/shorts",
      "token.actions.githubusercontent.com:repository_id": "12345",
      "token.actions.githubusercontent.com:repository_owner_id": "67890",
      "token.actions.githubusercontent.com:workflow": "Verify editor release candidate",
      ...(verifier ? {
        "token.actions.githubusercontent.com:environment":
          "editor-v4-release-approval",
      } : {}),
    },
  };
}

function oidcRole(ref, verifier = false) {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRoleWithWebIdentity",
          Effect: "Allow",
          Principal: {
            Federated:
              "arn:aws:iam::181651591905:oidc-provider/token.actions.githubusercontent.com",
          },
          Condition: exactCondition(ref, verifier),
        }],
      },
      MaxSessionDuration: verifier ? 7200 : 3600,
      Tags: tags,
    },
    Metadata: { "aws:cdk:path": `Stack/${verifier ? "Verifier" : "Build"}/Resource` },
  };
}

function registrarRole() {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
      }] },
      ManagedPolicyArns: [{ "Fn::Join": ["", [
        "arn:", { Ref: "AWS::Partition" },
        ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      ]] }],
      Tags: tags,
    },
    Metadata: { "aws:cdk:path": "Stack/RegistrarRole/Resource" },
  };
}

function iamPolicy(roleRef, name, statements) {
  return {
    Type: "AWS::IAM::Policy",
    Properties: {
      PolicyName: name,
      PolicyDocument: { Version: "2012-10-17", Statement: statements },
      Roles: [{ Ref: roleRef }],
    },
    Metadata: { "aws:cdk:path": `Stack/${name}/Resource` },
  };
}

function editorRepository() {
  return { "Fn::ImportValue":
    "ShortsMvpEditorRepository-production:EditorReleaseRepositoryArn" };
}

function buildPolicy() {
  return iamPolicy(
    "EditorReleaseBuildRole111C67A7",
    "EditorReleaseBuildRoleDefaultPolicyF82DF532",
    [
      { Action: [
        "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:UploadLayerPart",
        "ecr:InitiateLayerUpload", "ecr:PutImage",
      ], Effect: "Allow", Resource: editorRepository() },
      { Action: "ecr:GetAuthorizationToken", Effect: "Allow", Resource: "*" },
      { Action: ["ecr:DescribeImages", "ecr:DescribeImageScanFindings"],
        Effect: "Allow", Resource: editorRepository() },
    ],
  );
}

function verifierPolicy() {
  return iamPolicy(
    "EditorReleaseVerifierRoleBAFDF9FA",
    "EditorReleaseVerifierRoleDefaultPolicy97A1748C",
    [
      { Action: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"], Effect: "Allow", Resource: editorRepository() },
      { Action: "ecr:GetAuthorizationToken", Effect: "Allow", Resource: "*" },
      { Action: "lambda:InvokeFunction", Effect: "Allow", Resource: [
        { "Fn::GetAtt": ["EditorReleaseRegistrarFunctionD787453A", "Arn"] },
        { "Fn::Join": ["", [
          { "Fn::GetAtt": ["EditorReleaseRegistrarFunctionD787453A", "Arn"] },
          ":*",
        ]] },
      ] },
      { Action: ["batch:DescribeJobDefinitions", "batch:DescribeJobs"],
        Effect: "Allow", Resource: "*" },
      { Action: ["ecr:DescribeImages", "ecr:DescribeImageScanFindings"],
        Effect: "Allow", Resource: editorRepository() },
      { Action: ["s3:GetObject", "s3:GetObjectVersion"], Effect: "Allow",
        Resource: "arn:aws:s3:::shorts-mvp-editor-test/editor-release-probes/*" },
    ],
  );
}

function registrarPolicy() {
  return iamPolicy(
    "EditorReleaseRegistrarRole9129B368",
    "EditorReleaseRegistrarRoleDefaultPolicy3320C259",
    [
      { Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        Effect: "Allow", Resource: { "Fn::ImportValue": "WorkerRuntimeSecret" } },
      { Action: ["ecr:DescribeImageScanFindings", "ecr:DescribeImages"],
        Effect: "Allow", Resource: editorRepository() },
      { Action: ["s3:GetObject", "s3:GetObjectVersion"], Effect: "Allow",
        Resource: "arn:aws:s3:::shorts-mvp-editor-test/editor-release-probes/*" },
      { Action: ["batch:DescribeJobDefinitions", "batch:DescribeJobs", "batch:ListJobs",
        "batch:RegisterJobDefinition"], Effect: "Allow", Resource: "*" },
      { Action: "batch:SubmitJob", Effect: "Allow", Resource: [
        "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test",
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-test-release-*",
      ] },
      { Action: "batch:TagResource", Effect: "Allow", Resource: [
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-release-*",
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-test-release-*",
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-*",
      ] },
      { Action: "iam:PassRole", Effect: "Allow", Resource: PASS_ROLE_ARNS,
        Condition: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } } },
    ],
  );
}

function sharedEditorPolicy(includeProbePermissions) {
  const statements = [
    { Action: ["batch:DescribeJobs", "batch:SubmitJob"], Effect: "Allow", Resource: "*" },
  ];
  if (includeProbePermissions) {
    statements.push(
      { Action: "ecr:DescribeImageScanFindings", Effect: "Allow",
        Resource: editorRepository() },
      { Action: "s3:GetObject", Effect: "Allow",
        Resource: "arn:aws:s3:::shorts-mvp-editor-test/editor-release-probes/*" },
    );
  }
  return iamPolicy(
    "EditorCanaryLambdaRole595EC6BE",
    "EditorCanaryLambdaRoleDefaultPolicy2BA45784",
    statements,
  );
}

function target(name, source, revision, queue, releaseId) {
  return {
    releaseId,
    workerSourceGitSha: source,
    imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
    jobDefinitionArn:
      `arn:aws:batch:ap-northeast-2:181651591905:job-definition/${name}-${source.slice(0, 7)}:${revision}`,
    jobQueueArn:
      `arn:aws:batch:ap-northeast-2:181651591905:job-queue/${queue}`,
  };
}

function rotationRegistry() {
  const source = "b".repeat(40);
  const previousSource = "c".repeat(40);
  return {
    version: 1,
    environment: "production",
    lanes: {
      legacy_project: {
        schedulingMode: "fair_share",
        current: target("legacy", source, 2, "project", "legacy-current"),
        previous: null,
      },
      source_range: {
        schedulingMode: "fair_share",
        current: target("source", source, 2, "source", "source-current"),
        previous: null,
      },
      elevenlabs_transcription: {
        schedulingMode: "fair_share",
        current: target("eleven", source, 2, "shared", "eleven-current"),
        previous: null,
      },
      subtitle_templates: {
        schedulingMode: "fair_share",
        current: target("subtitle", source, 2, "shared", "subtitle-current"),
        previous: null,
      },
      unified_template_subtitles: {
        schedulingMode: "fifo",
        current: target("unified", source, 2, "prepare", "unified-current"),
        previous: target(
          "unified-old",
          previousSource,
          1,
          "prepare",
          "unified-previous",
        ),
      },
    },
  };
}

const bootstrapOptions = {
  phase: "bootstrap",
  githubOrg: "dongk176",
  githubRepo: "shorts",
  githubEditorReleaseRef: STAGE_B_EDITOR_RELEASE_REF,
  githubRepositoryId: "12345",
  githubRepositoryOwnerId: "67890",
  registrarPassRoleArns: PASS_ROLE_ARNS,
  projectTargets: rotationRegistry(),
};

function registrarEnvironment(registry) {
  const legacyQueue = registry.lanes.legacy_project.current.jobQueueArn;
  return {
    RUNTIME_SECRET_ARN: { "Fn::ImportValue": "WorkerRuntimeSecret" },
    MEDIA_BUCKET: { "Fn::ImportValue": "MediaBucket" },
    PROJECT_BATCH_QUEUE: legacyQueue,
    EDITOR_STABLE_BATCH_QUEUE: legacyQueue,
    EDITOR_CANARY_BATCH_QUEUE: {
      "Fn::GetAtt": ["EditorCanaryQueue", "JobQueueArn"],
    },
    RERENDER_JOB_DEFINITION:
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-rerender-fargate-production:27",
    EDITOR_TEST_BUCKET_NAME: "shorts-mvp-editor-test-181651591905-ap-northeast-2",
    EDITOR_TEST_TEMPLATE_JOB_DEFINITION: "shorts-mvp-editor-test-template",
    EDITOR_WORK_DISPATCH_QUEUE_URL: { Ref: "EditorDispatchQueueD0065DA5" },
    WORK_DISPATCH_QUEUE_URL: { Ref: "EditorDispatchQueueD0065DA5" },
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    GITHUB_OIDC_AUDIENCE: "editor-v4-release-registrar",
    GITHUB_OIDC_REPOSITORY: "dongk176/shorts",
    GITHUB_OIDC_REPOSITORY_ID: "12345",
    GITHUB_OIDC_REPOSITORY_OWNER_ID: "67890",
    GITHUB_OIDC_ENVIRONMENT: "editor-v4-release-approval",
    GITHUB_OIDC_RELEASE_TAG: "editor-v4-render-parity-20260827-4",
    GITHUB_OIDC_WORKFLOW_PATH: ".github/workflows/editor-release.yml",
    GITHUB_OIDC_WORKFLOW_NAME: "Verify editor release candidate",
    EDITOR_RELEASE_ECR_REPOSITORY_URI:
      "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-release",
    EDITOR_TEST_JOB_QUEUE_ARN:
      "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test",
    EDITOR_TEST_TASK_ROLE_ARN:
      "arn:aws:iam::181651591905:role/shorts-mvp-editor-test-task",
    EDITOR_TEST_EXECUTION_ROLE_ARN:
      "arn:aws:iam::181651591905:role/shorts-mvp-editor-test-execution",
    EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS: JSON.stringify(PASS_ROLE_ARNS),
  };
}

function editorBootstrapTemplates() {
  const currentEnvironment = {
    RUNTIME_SECRET_ARN: { "Fn::ImportValue": "WorkerRuntimeSecret" },
    MEDIA_BUCKET: { "Fn::ImportValue": "MediaBucket" },
    EDITOR_WORK_DISPATCH_QUEUE_URL: { Ref: "EditorDispatchQueueD0065DA5" },
    WORK_DISPATCH_QUEUE_URL: { Ref: "EditorDispatchQueueD0065DA5" },
  };
  const registrarOverrides = {
    Handler: "editor_release_registrar.handler",
  };
  const current = {
    Resources: {
      EditorReleaseRegistrarFunctionD787453A: lambda(
        "shorts-mvp-editor-release-registrar-production",
        "old.zip",
        currentEnvironment,
        registrarOverrides,
      ),
      EditorReleaseBuildRole111C67A7: oidcRole("refs/heads/legacy"),
      EditorReleaseBuildRoleDefaultPolicyF82DF532: iamPolicy(
        "EditorReleaseBuildRole111C67A7",
        "EditorReleaseBuildRoleDefaultPolicyF82DF532",
        [{ Action: "lambda:InvokeFunction", Effect: "Allow", Resource: "*" }],
      ),
      EditorCanaryLambdaRoleDefaultPolicy2BA45784: sharedEditorPolicy(true),
      ProtectedQueue: { Type: "AWS::Batch::JobQueue", Properties: { Priority: 1 } },
    },
    Outputs: { Existing: { Value: "kept" } },
  };
  const candidate = structuredClone(current);
  candidate.Resources.EditorReleaseRegistrarRole9129B368 = registrarRole();
  candidate.Resources.EditorReleaseRegistrarRoleDefaultPolicy3320C259 =
    registrarPolicy();
  candidate.Resources.EditorReleaseRegistrarFunctionD787453A = lambda(
    "shorts-mvp-editor-release-registrar-production",
    "new.zip",
    registrarEnvironment(bootstrapOptions.projectTargets),
    {
      Handler: "editor_release_registrar.handler",
      MemorySize: 512,
      Timeout: 300,
      Role: { "Fn::GetAtt": ["EditorReleaseRegistrarRole9129B368", "Arn"] },
      DependsOn: [
        "EditorReleaseRegistrarRoleDefaultPolicy3320C259",
        "EditorReleaseRegistrarRole9129B368",
      ],
    },
  );
  candidate.Resources.EditorReleaseBuildRole111C67A7 =
    oidcRole(STAGE_B_EDITOR_RELEASE_REF);
  candidate.Resources.EditorReleaseBuildRoleDefaultPolicyF82DF532 = buildPolicy();
  candidate.Resources.EditorCanaryLambdaRoleDefaultPolicy2BA45784 =
    sharedEditorPolicy(false);
  candidate.Resources.EditorReleaseVerifierRoleBAFDF9FA =
    oidcRole(STAGE_B_EDITOR_RELEASE_REF, true);
  candidate.Resources.EditorReleaseVerifierRoleDefaultPolicy97A1748C =
    verifierPolicy();
  candidate.Outputs.EditorReleaseVerifierRoleArn = {
    Value: { "Fn::GetAtt": ["EditorReleaseVerifierRoleBAFDF9FA", "Arn"] },
  };
  return { current, candidate };
}

function rotationEnvironment(registry) {
  const lane = registry.lanes;
  return {
    KEEP: "unchanged",
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    PROJECT_TARGET_REGISTRY_REQUIRED: "true",
    LEGACY_PROJECT_JOB_DEFINITION_ARN: lane.legacy_project.current.jobDefinitionArn,
    LEGACY_PROJECT_BATCH_QUEUE_ARN: lane.legacy_project.current.jobQueueArn,
    SOURCE_RANGE_JOB_DEFINITION_ARN: lane.source_range.current.jobDefinitionArn,
    SOURCE_RANGE_BATCH_QUEUE_ARN: lane.source_range.current.jobQueueArn,
    ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN:
      lane.elevenlabs_transcription.current.jobDefinitionArn,
    ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN:
      lane.elevenlabs_transcription.current.jobQueueArn,
    SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
      lane.subtitle_templates.current.jobDefinitionArn,
    SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN:
      lane.subtitle_templates.current.jobQueueArn,
    UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN:
      lane.unified_template_subtitles.current.jobDefinitionArn,
    UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN:
      lane.unified_template_subtitles.current.jobQueueArn,
    UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN:
      lane.unified_template_subtitles.previous.jobDefinitionArn,
  };
}

test("bootstrap builds exact registrar, IAM, and submitter templates", () => {
  const { current, candidate } = editorBootstrapTemplates();
  const exact = buildExactStageBTemplate(
    "bootstrap",
    "editor",
    current,
    candidate,
    bootstrapOptions,
  );
  assert.deepEqual(exact.Resources.ProtectedQueue, current.Resources.ProtectedQueue);
  assert.deepEqual(
    exact.Resources.EditorReleaseRegistrarFunctionD787453A.Metadata,
    current.Resources.EditorReleaseRegistrarFunctionD787453A.Metadata,
  );
  assert.equal(
    validateExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      exact,
      bootstrapOptions,
    ).length,
    8,
  );

  const computeCurrent = { Resources: {
    BatchSubmitterFunction95B3701F: lambda("submitter", "old.zip", { KEEP: "yes" }),
  } };
  const computeCandidate = { Resources: {
    BatchSubmitterFunction95B3701F: lambda("submitter", "new.zip", { KEEP: "yes" }),
  } };
  assert.equal(
    validateExactStageBTemplate(
      "bootstrap",
      "compute",
      computeCurrent,
      buildExactStageBTemplate(
        "bootstrap",
        "compute",
        computeCurrent,
        computeCandidate,
        bootstrapOptions,
      ),
      bootstrapOptions,
    ).length,
    1,
  );
});

test("renewal changes only the exact registrar identity and build-role tag", () => {
  const { current, candidate } = editorBootstrapTemplates();
  const live = buildExactStageBTemplate(
    "bootstrap",
    "editor",
    current,
    candidate,
    bootstrapOptions,
  );
  const renewalCurrent = structuredClone(live);
  renewalCurrent.Resources.EditorReleaseRegistrarFunctionD787453A
    .Properties.Environment.Variables.GITHUB_OIDC_RELEASE_TAG =
      "editor-v4-render-parity-20260826";
  renewalCurrent.Resources.EditorReleaseBuildRole111C67A7 =
    oidcRole("refs/tags/editor-v4-render-parity-20260826");
  const renewalCandidate = structuredClone(live);
  renewalCandidate.Resources.EditorReleaseRegistrarFunctionD787453A.Properties.Code = {
    S3Bucket: "cdk-hnb659fds-assets-181651591905-ap-northeast-2",
    S3Key: `${"c".repeat(64)}.zip`,
  };
  const renewalExact = buildExactStageBTemplate(
    "renewal",
    "editor",
    renewalCurrent,
    renewalCandidate,
    bootstrapOptions,
  );
  assert.deepEqual(stageBStackKeys("renewal"), ["editor"]);
  assert.equal(
    validateExactStageBTemplate(
      "renewal",
      "editor",
      renewalCurrent,
      renewalExact,
      bootstrapOptions,
    ).length,
    2,
  );
  const unsafe = structuredClone(renewalCandidate);
  unsafe.Resources.EditorReleaseBuildRoleDefaultPolicyF82DF532
    .Properties.PolicyDocument.Statement.push({
      Action: "iam:*",
      Effect: "Allow",
      Resource: "*",
    });
  assert.throws(
    () => buildExactStageBTemplate(
      "renewal",
      "editor",
      renewalCurrent,
      unsafe,
      bootstrapOptions,
    ),
    /범위 밖 변경/,
  );
});

test("deployment projection excludes unrelated full-synth drift", () => {
  const { current, candidate } = editorBootstrapTemplates();
  const fullCandidate = structuredClone(candidate);
  fullCandidate.Resources.ProtectedQueue = {
    ...fullCandidate.Resources.ProtectedQueue,
    Properties: { QueueName: "must-never-be-deployed" },
  };
  assert.throws(
    () => buildExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      fullCandidate,
      bootstrapOptions,
    ),
    /범위 밖 변경/,
  );
  const projected = projectExactStageBDeploymentCandidate(
    "bootstrap",
    "editor",
    current,
    fullCandidate,
  );
  assert.deepEqual(projected.Resources.ProtectedQueue, current.Resources.ProtectedQueue);
  assert.equal(
    validateExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      buildExactStageBTemplate(
        "bootstrap",
        "editor",
        current,
        projected,
        bootstrapOptions,
      ),
      bootstrapOptions,
    ).length,
    8,
  );

  const missing = structuredClone(fullCandidate);
  delete missing.Resources.EditorReleaseVerifierRoleBAFDF9FA;
  assert.throws(
    () => projectExactStageBDeploymentCandidate(
      "bootstrap",
      "editor",
      current,
      missing,
    ),
    /필수 resource/,
  );
});

test("proves the live Editor resources match the exact HEAD candidate", () => {
  const { current, candidate } = editorBootstrapTemplates();
  const applied = buildExactStageBTemplate(
    "bootstrap",
    "editor",
    current,
    candidate,
    bootstrapOptions,
  );
  assert.deepEqual(
    validateAppliedStageBTemplate(
      "bootstrap",
      "editor",
      applied,
      candidate,
      bootstrapOptions,
    ),
    [
      "EditorReleaseRegistrarRole9129B368",
      "EditorReleaseRegistrarRoleDefaultPolicy3320C259",
      "EditorReleaseRegistrarFunctionD787453A",
      "EditorCanaryLambdaRoleDefaultPolicy2BA45784",
      "EditorReleaseBuildRole111C67A7",
      "EditorReleaseBuildRoleDefaultPolicyF82DF532",
      "EditorReleaseVerifierRoleBAFDF9FA",
      "EditorReleaseVerifierRoleDefaultPolicy97A1748C",
    ],
  );
  const differentHead = structuredClone(candidate);
  differentHead.Resources.EditorReleaseRegistrarFunctionD787453A
    .Properties.Code.S3Key = `${"d".repeat(64)}.zip`;
  assert.throws(
    () => validateAppliedStageBTemplate(
      "bootstrap",
      "editor",
      applied,
      differentHead,
      bootstrapOptions,
    ),
    /live resource가 exact HEAD 후보와 다릅니다/,
  );
});

test("rotation allows only registry assets and exact current target env", () => {
  const registry = rotationRegistry();
  const options = { ...bootstrapOptions, phase: "rotation", projectTargets: registry };
  const editorCurrent = { Resources: {
    EditorReleaseRegistrarFunctionD787453A: lambda("registrar", "old.zip", {
      PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    }),
  } };
  const editorCandidate = { Resources: {
    EditorReleaseRegistrarFunctionD787453A: lambda("registrar", "new.zip", {
      PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    }),
  } };
  assert.doesNotThrow(() => buildExactStageBTemplate(
    "rotation",
    "editor",
    editorCurrent,
    editorCandidate,
    options,
  ));

  const computeCurrent = { Resources: {
    BatchSubmitterFunction95B3701F: lambda("submitter", "old.zip", {
      KEEP: "unchanged",
      PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
      PROJECT_TARGET_REGISTRY_REQUIRED: "true",
      LEGACY_PROJECT_JOB_DEFINITION_ARN: "old",
    }),
  } };
  const computeCandidate = { Resources: {
    BatchSubmitterFunction95B3701F: lambda(
      "submitter",
      "new.zip",
      rotationEnvironment(registry),
    ),
  } };
  assert.doesNotThrow(() => buildExactStageBTemplate(
    "rotation",
    "compute",
    computeCurrent,
    computeCandidate,
    options,
  ));
  computeCandidate.Resources.BatchSubmitterFunction95B3701F
    .Properties.Environment.Variables.UNRELATED = "forbidden";
  assert.throws(
    () => buildExactStageBTemplate(
      "rotation",
      "compute",
      computeCurrent,
      computeCandidate,
      options,
    ),
    /exact target env 밖 변경/,
  );
});

test("lockdown permits only the disabled exact OIDC subject", () => {
  const current = { Resources: {
    EditorReleaseBuildRole111C67A7: oidcRole(STAGE_B_EDITOR_RELEASE_REF),
    ProtectedQueue: { Type: "AWS::Batch::JobQueue", Properties: { Priority: 1 } },
  } };
  const candidate = structuredClone(current);
  candidate.Resources.EditorReleaseBuildRole111C67A7 =
    oidcRole(STAGE_B_DISABLED_EDITOR_RELEASE_REF);
  const options = {
    ...bootstrapOptions,
    phase: "lockdown",
    githubEditorReleaseRef: STAGE_B_DISABLED_EDITOR_RELEASE_REF,
  };
  assert.deepEqual(stageBStackKeys("lockdown"), ["editor"]);
  assert.doesNotThrow(() => buildExactStageBTemplate(
    "lockdown",
    "editor",
    current,
    candidate,
    options,
  ));
  assert.throws(
    () => buildExactStageBTemplate(
      "lockdown",
      "editor",
      current,
      candidate,
      bootstrapOptions,
    ),
    /exact contract|exact OIDC ref/,
  );
});

test("rejects Queue, ComputeEnvironment, JobDefinition, and template-envelope drift", () => {
  const { current, candidate } = editorBootstrapTemplates();
  candidate.Resources.ProtectedQueue.Properties.Priority = 2;
  assert.throws(
    () => buildExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      candidate,
      bootstrapOptions,
    ),
    /범위 밖 변경/,
  );
  candidate.Resources.ProtectedQueue = current.Resources.ProtectedQueue;
  candidate.Resources.UnexpectedDefinition = {
    Type: "AWS::Batch::JobDefinition",
    Properties: {},
  };
  assert.throws(
    () => buildExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      candidate,
      bootstrapOptions,
    ),
    /범위 밖 변경/,
  );
  delete candidate.Resources.UnexpectedDefinition;
  candidate.Outputs = { Unexpected: { Value: "drift" } };
  assert.throws(
    () => buildExactStageBTemplate(
      "bootstrap",
      "editor",
      current,
      candidate,
      bootstrapOptions,
    ),
    /verifier role output contract|Parameters\/Outputs\/Conditions/,
  );
});

test("accepts only phase-approved exact refs", () => {
  assert.equal(
    validateStageBEditorReleaseRef(STAGE_B_DISABLED_EDITOR_RELEASE_REF, "lockdown"),
    STAGE_B_DISABLED_EDITOR_RELEASE_REF,
  );
  assert.equal(
    validateStageBEditorReleaseRef(STAGE_B_EDITOR_RELEASE_REF, "bootstrap"),
    STAGE_B_EDITOR_RELEASE_REF,
  );
  assert.throws(
    () => validateStageBEditorReleaseRef("refs/heads/codex/*", "bootstrap"),
    /exact tag/,
  );
});

test("prepared preview has exact resources with no replacement", () => {
  const modified = [
    ["EditorReleaseRegistrarFunctionD787453A", "AWS::Lambda::Function", "Code"],
    ["EditorCanaryLambdaRoleDefaultPolicy2BA45784", "AWS::IAM::Policy", "PolicyDocument"],
    ["EditorReleaseBuildRole111C67A7", "AWS::IAM::Role", "AssumeRolePolicyDocument"],
    ["EditorReleaseBuildRoleDefaultPolicyF82DF532", "AWS::IAM::Policy", "PolicyDocument"],
  ].map(([LogicalResourceId, ResourceType, propertyName]) => ({ ResourceChange: {
    Action: "Modify",
    LogicalResourceId,
    ResourceType,
    Replacement: "False",
    Scope: ["Properties"],
    Details: [{
      ChangeSource: "DirectModification",
      Evaluation: "Static",
      Target: {
        Attribute: "Properties",
        AttributeChangeType: "Modify",
        Name: propertyName,
        RequiresRecreation: "Never",
      },
    }],
  } }));
  const added = [
    ["EditorReleaseRegistrarRole9129B368", "AWS::IAM::Role"],
    ["EditorReleaseRegistrarRoleDefaultPolicy3320C259", "AWS::IAM::Policy"],
    ["EditorReleaseVerifierRoleBAFDF9FA", "AWS::IAM::Role"],
    ["EditorReleaseVerifierRoleDefaultPolicy97A1748C", "AWS::IAM::Policy"],
  ].map(([LogicalResourceId, ResourceType]) => ({ ResourceChange: {
    Action: "Add",
    LogicalResourceId,
    ResourceType,
    Replacement: null,
    Scope: [],
    Details: [],
  } }));
  const changes = [...added, ...modified];
  const preview = {
    StackName: "ShortsMvpEditorCanary-production",
    ChangeSetType: "UPDATE",
    Status: "CREATE_COMPLETE",
    ExecutionStatus: "AVAILABLE",
    Changes: changes,
  };
  assert.doesNotThrow(() => validatePreparedStageBChangeSet(
    "bootstrap",
    "editor",
    preview,
  ));
  const apiPreview = structuredClone(preview);
  delete apiPreview.ChangeSetType;
  assert.doesNotThrow(() => validatePreparedStageBChangeSet(
    "bootstrap",
    "editor",
    apiPreview,
  ));
  assert.throws(
    () => validatePreparedStageBChangeSet(
      "bootstrap",
      "editor",
      { ...preview, ChangeSetType: "CREATE" },
    ),
    /실행 가능 UPDATE preview/,
  );
  const originalRegistrarDetails = structuredClone(
    modified[0].ResourceChange.Details,
  );
  modified[0].ResourceChange.Details = [
    {
      ChangeSource: "DirectModification",
      Evaluation: "Dynamic",
      Target: {
        Attribute: "Properties",
        AttributeChangeType: "Modify",
        Name: "Role",
        RequiresRecreation: "Never",
      },
    },
    {
      CausingEntity: "EditorReleaseRegistrarRole9129B368.Arn",
      ChangeSource: "ResourceAttribute",
      Evaluation: "Static",
      Target: {
        Attribute: "Properties",
        AttributeChangeType: "Modify",
        Name: "Role",
        RequiresRecreation: "Never",
      },
    },
  ];
  assert.doesNotThrow(() => validatePreparedStageBChangeSet(
    "bootstrap",
    "editor",
    preview,
  ));
  modified[0].ResourceChange.Details[1].CausingEntity = "UnexpectedRole.Arn";
  assert.throws(
    () => validatePreparedStageBChangeSet("bootstrap", "editor", preview),
    /Role dependency detail 집합/,
  );
  modified[0].ResourceChange.Details = originalRegistrarDetails;
  changes[0].ResourceChange.Replacement = "Conditional";
  assert.throws(
    () => validatePreparedStageBChangeSet("bootstrap", "editor", preview),
    /범위\/교체 계약 위반/,
  );
  changes[0].ResourceChange.Replacement = "False";
  modified[0].ResourceChange.Details[0].Target.Name = "ReservedConcurrentExecutions";
  assert.throws(
    () => validatePreparedStageBChangeSet("bootstrap", "editor", preview),
    /property detail 계약 위반/,
  );
});

test("the verifier is read-only and cannot mutate DB, Vercel, Batch, or CloudFormation", async () => {
  const source = await readFile(
    new URL("./verify-stage-b-release-control-template-diff.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:cdk\s+deploy|execute-change-set|register-job-definition|update-job-queue|update-compute-environment|apply-supabase|vercel\s+(?:deploy|promote|env))/,
  );
});
