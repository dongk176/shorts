#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readProductionProjectTargets,
  validateProductionProjectTargets,
} from "./production-project-targets.mjs";

export const STAGE_B_EDITOR_RELEASE_REF =
  "refs/tags/editor-v4-render-parity-20260830-2";
export const STAGE_B_DISABLED_EDITOR_RELEASE_REF =
  "refs/tags/__disabled_editor_release__";

export const STAGE_B_STACKS = Object.freeze({
  editor: Object.freeze({
    stackName: "ShortsMvpEditorCanary-production",
    templateFile: "ShortsMvpEditorCanary-production.template.json",
  }),
  compute: Object.freeze({
    stackName: "ShortsMvpCompute-production",
    templateFile: "ShortsMvpCompute-production.template.json",
  }),
});

export const STAGE_B_PHASE_CONTRACTS = Object.freeze({
  bootstrap: Object.freeze({
    editorReleaseRef: STAGE_B_EDITOR_RELEASE_REF,
    stacks: Object.freeze({
      editor: Object.freeze({
        EditorReleaseRegistrarRole9129B368: "AWS::IAM::Role",
        EditorReleaseRegistrarRoleDefaultPolicy3320C259: "AWS::IAM::Policy",
        EditorReleaseRegistrarFunctionD787453A: "AWS::Lambda::Function",
        EditorCanaryLambdaRoleDefaultPolicy2BA45784: "AWS::IAM::Policy",
        EditorReleaseBuildRole111C67A7: "AWS::IAM::Role",
        EditorReleaseBuildRoleDefaultPolicyF82DF532: "AWS::IAM::Policy",
        EditorReleaseVerifierRoleBAFDF9FA: "AWS::IAM::Role",
        EditorReleaseVerifierRoleDefaultPolicy97A1748C: "AWS::IAM::Policy",
      }),
      compute: Object.freeze({
        BatchSubmitterFunction95B3701F: "AWS::Lambda::Function",
      }),
    }),
  }),
  renewal: Object.freeze({
    editorReleaseRef: STAGE_B_EDITOR_RELEASE_REF,
    stacks: Object.freeze({
      editor: Object.freeze({
        EditorReleaseRegistrarFunctionD787453A: "AWS::Lambda::Function",
        EditorReleaseRegistrarRoleDefaultPolicy3320C259: "AWS::IAM::Policy",
        EditorReleaseBuildRole111C67A7: "AWS::IAM::Role",
        EditorReleaseVerifierRoleBAFDF9FA: "AWS::IAM::Role",
      }),
    }),
  }),
  rotation: Object.freeze({
    editorReleaseRef: STAGE_B_EDITOR_RELEASE_REF,
    stacks: Object.freeze({
      editor: Object.freeze({
        EditorReleaseRegistrarFunctionD787453A: "AWS::Lambda::Function",
      }),
      compute: Object.freeze({
        BatchSubmitterFunction95B3701F: "AWS::Lambda::Function",
      }),
    }),
  }),
  lockdown: Object.freeze({
    editorReleaseRef: STAGE_B_DISABLED_EDITOR_RELEASE_REF,
    stacks: Object.freeze({
      editor: Object.freeze({
        EditorReleaseBuildRole111C67A7: "AWS::IAM::Role",
      }),
    }),
  }),
});

const TARGET_ENVIRONMENT_KEYS = Object.freeze([
  "LEGACY_PROJECT_JOB_DEFINITION_ARN",
  "LEGACY_PROJECT_BATCH_QUEUE_ARN",
  "SOURCE_RANGE_JOB_DEFINITION_ARN",
  "SOURCE_RANGE_BATCH_QUEUE_ARN",
  "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
  "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
  "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
  "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
  "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN",
  "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN",
  "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN",
]);

const PHASE_PROPERTY_CONTRACTS = Object.freeze({
  bootstrap: Object.freeze({
    editor: Object.freeze({
      EditorReleaseRegistrarRole9129B368: Object.freeze([]),
      EditorReleaseRegistrarRoleDefaultPolicy3320C259: Object.freeze([]),
      EditorReleaseRegistrarFunctionD787453A: Object.freeze([
        "Code", "Environment", "MemorySize", "Role", "Timeout",
      ]),
      EditorCanaryLambdaRoleDefaultPolicy2BA45784: Object.freeze([
        "PolicyDocument",
      ]),
      EditorReleaseBuildRole111C67A7: Object.freeze(["AssumeRolePolicyDocument"]),
      EditorReleaseBuildRoleDefaultPolicyF82DF532: Object.freeze(["PolicyDocument"]),
      EditorReleaseVerifierRoleBAFDF9FA: Object.freeze([]),
      EditorReleaseVerifierRoleDefaultPolicy97A1748C: Object.freeze([]),
    }),
    compute: Object.freeze({
      BatchSubmitterFunction95B3701F: Object.freeze(["Code"]),
    }),
  }),
  renewal: Object.freeze({
    editor: Object.freeze({
      EditorReleaseRegistrarFunctionD787453A: Object.freeze([
        "Code", "Environment",
      ]),
      EditorReleaseRegistrarRoleDefaultPolicy3320C259: Object.freeze([
        "PolicyDocument",
      ]),
      EditorReleaseBuildRole111C67A7: Object.freeze(["AssumeRolePolicyDocument"]),
      EditorReleaseVerifierRoleBAFDF9FA: Object.freeze(["AssumeRolePolicyDocument"]),
    }),
  }),
  rotation: Object.freeze({
    editor: Object.freeze({
      EditorReleaseRegistrarFunctionD787453A: Object.freeze(["Code"]),
    }),
    compute: Object.freeze({
      BatchSubmitterFunction95B3701F: Object.freeze(["Code", "Environment"]),
    }),
  }),
  lockdown: Object.freeze({
    editor: Object.freeze({
      EditorReleaseBuildRole111C67A7: Object.freeze(["AssumeRolePolicyDocument"]),
    }),
  }),
});

const BOOTSTRAP_ADDED_EDITOR_RESOURCES = new Set([
  "EditorReleaseRegistrarRole9129B368",
  "EditorReleaseRegistrarRoleDefaultPolicy3320C259",
  "EditorReleaseVerifierRoleBAFDF9FA",
  "EditorReleaseVerifierRoleDefaultPolicy97A1748C",
]);

function expectedResourceAction(phase, stackKey, logicalId) {
  if (
    phase === "bootstrap"
    && stackKey === "editor"
    && BOOTSTRAP_ADDED_EDITOR_RESOURCES.has(logicalId)
  ) return "add";
  return "update";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function fingerprint(value) {
  return JSON.stringify(stable(value));
}

function resources(template) {
  const value = template?.Resources;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CloudFormation template Resources가 올바르지 않습니다.");
  }
  return value;
}

function templateEnvelope(template) {
  const value = clone(template);
  delete value.Resources;
  return value;
}

function exactTemplateEnvelope(phase, stackKey, currentTemplate, candidateTemplate) {
  const expected = templateEnvelope(currentTemplate);
  const candidate = templateEnvelope(candidateTemplate);
  if (phase === "bootstrap" && stackKey === "editor") {
    const exactVerifierOutput = {
      Value: { "Fn::GetAtt": ["EditorReleaseVerifierRoleBAFDF9FA", "Arn"] },
    };
    const currentVerifierOutput = expected?.Outputs?.EditorReleaseVerifierRoleArn;
    const verifierOutput = candidate?.Outputs?.EditorReleaseVerifierRoleArn;
    if (
      (
        currentVerifierOutput !== undefined
        && fingerprint(currentVerifierOutput) !== fingerprint(exactVerifierOutput)
      )
      || fingerprint(verifierOutput) !== fingerprint(exactVerifierOutput)
    ) {
      throw new Error("Stage B verifier role output contract가 다릅니다.");
    }
    if (currentVerifierOutput === undefined) {
      expected.Outputs = {
        ...(expected.Outputs || {}),
        EditorReleaseVerifierRoleArn: clone(verifierOutput),
      };
    }
  }
  if (fingerprint(expected) !== fingerprint(candidate)) {
    throw new Error("Stage B template의 Parameters/Outputs/Conditions 등 범위 밖 변경입니다.");
  }
  return expected;
}

export function validateStageBPhase(value) {
  const phase = String(value || "").trim();
  if (!Object.hasOwn(STAGE_B_PHASE_CONTRACTS, phase)) {
    throw new Error(
      "Stage B phase는 bootstrap, renewal, rotation, lockdown 중 하나여야 합니다.",
    );
  }
  return phase;
}

export function stageBStackKeys(phaseValue) {
  const phase = validateStageBPhase(phaseValue);
  return Object.keys(STAGE_B_PHASE_CONTRACTS[phase].stacks);
}

function contractFor(phaseValue, stackKey) {
  const phase = validateStageBPhase(phaseValue);
  const stack = STAGE_B_STACKS[stackKey];
  const resourcesContract = STAGE_B_PHASE_CONTRACTS[phase].stacks[stackKey];
  if (!stack || !resourcesContract) {
    throw new Error(`${phase} 단계에서 허용되지 않은 Stage B stack입니다: ${stackKey}`);
  }
  return { phase, ...stack, resources: resourcesContract };
}

function validateContractChangeCompleteness(contract, logicalIds, context) {
  const seen = new Set(logicalIds);
  if (!seen.size) {
    throw new Error(`Stage B ${contract.phase} ${context}이 없습니다.`);
  }
  // Renewal also repairs a partially-applied exact release identity. The
  // allowlist remains fixed, while already-correct resources stay untouched.
  if (contract.phase === "renewal") return;
  const missing = Object.keys(contract.resources).filter(
    (logicalId) => !seen.has(logicalId),
  );
  if (missing.length) {
    throw new Error(
      `Stage B ${contract.phase} ${context} 누락: ${missing.join(", ")}`,
    );
  }
}

export function validateStageBEditorReleaseRef(value, phaseValue = "") {
  const ref = String(value || "").trim();
  if (![
    STAGE_B_DISABLED_EDITOR_RELEASE_REF,
    STAGE_B_EDITOR_RELEASE_REF,
  ].includes(ref)) {
    throw new Error("Stage B OIDC ref는 승인된 exact tag 또는 disabled sentinel이어야 합니다.");
  }
  if (phaseValue) {
    const phase = validateStageBPhase(phaseValue);
    const expected = STAGE_B_PHASE_CONTRACTS[phase].editorReleaseRef;
    if (ref !== expected) {
      throw new Error(`${phase} 단계의 exact OIDC ref가 아닙니다.`);
    }
  }
  return ref;
}

export function stageBTemplateResourceChanges(currentTemplate, candidateTemplate) {
  const current = resources(currentTemplate);
  const candidate = resources(candidateTemplate);
  const logicalIds = new Set([...Object.keys(current), ...Object.keys(candidate)]);
  return [...logicalIds].sort().flatMap((logicalId) => {
    const before = current[logicalId];
    const after = candidate[logicalId];
    if (fingerprint(before) === fingerprint(after)) return [];
    return [{
      logicalId,
      type: String(after?.Type || before?.Type || ""),
      action: before ? (after ? "update" : "delete") : "add",
      before,
      after,
    }];
  });
}

/**
 * Materialize the only template that may be submitted to CloudFormation.
 *
 * CDK's full stack synthesis can contain unrelated asset hash or retained
 * JobDefinition drift. Those resources must never reach a Stage B ChangeSet.
 * Start from the live template and copy only the phase's fixed logical-ID
 * contract; the copied resources are still validated property-by-property by
 * buildExactStageBTemplate and validatePreparedStageBChangeSet.
 */
export function projectExactStageBDeploymentCandidate(
  phaseValue,
  stackKey,
  currentTemplate,
  fullCandidateTemplate,
) {
  const contract = contractFor(phaseValue, stackKey);
  const current = resources(currentTemplate);
  const candidate = resources(fullCandidateTemplate);
  const projected = clone(currentTemplate);
  projected.Resources = clone(current);
  for (const [logicalId, expectedType] of Object.entries(contract.resources)) {
    const resource = candidate[logicalId];
    if (!resource || resource.Type !== expectedType) {
      throw new Error(`Stage B HEAD 후보에 필수 resource가 없습니다: ${logicalId}`);
    }
    projected.Resources[logicalId] = clone(resource);
  }
  if (contract.phase === "bootstrap" && stackKey === "editor") {
    const verifierOutput = fullCandidateTemplate?.Outputs?.EditorReleaseVerifierRoleArn;
    if (fingerprint(verifierOutput) !== fingerprint({
      Value: { "Fn::GetAtt": ["EditorReleaseVerifierRoleBAFDF9FA", "Arn"] },
    })) {
      throw new Error("Stage B HEAD 후보의 verifier role output이 다릅니다.");
    }
    projected.Outputs = {
      ...(projected.Outputs || {}),
      EditorReleaseVerifierRoleArn: clone(verifierOutput),
    };
  }
  return projected;
}

function copyLambdaAsset(current, candidate, logicalId) {
  if (
    current?.Type !== "AWS::Lambda::Function"
    || candidate?.Type !== "AWS::Lambda::Function"
  ) {
    throw new Error(`${logicalId} Lambda resource contract가 올바르지 않습니다.`);
  }
  const expected = clone(current);
  const candidateCode = candidate.Properties?.Code;
  const codeKeys = Object.keys(candidateCode || {}).sort();
  const bucket = candidateCode?.S3Bucket;
  const bucketIsPinned = (
    (typeof bucket === "string"
      && /^cdk-[a-z0-9]+-assets-[0-9]{12}-[a-z0-9-]+$/.test(bucket))
    || fingerprint(bucket) === fingerprint({
      "Fn::Sub": "cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}",
    })
  );
  if (
    !candidateCode
    || fingerprint(codeKeys) !== fingerprint(["S3Bucket", "S3Key"])
    || !bucketIsPinned
    || !/^[0-9a-f]{64}\.zip$/.test(String(candidateCode.S3Key || ""))
  ) {
    throw new Error(`${logicalId} Lambda asset이 immutable S3 asset이 아닙니다.`);
  }
  expected.Properties.Code = clone(candidateCode);
  const normalizedCandidate = clone(candidate);
  if (current.Metadata === undefined) delete normalizedCandidate.Metadata;
  else normalizedCandidate.Metadata = clone(current.Metadata);
  return { expected, normalizedCandidate };
}

function exactBootstrapBatchSubmitter(current, candidate) {
  const { expected, normalizedCandidate } = copyLambdaAsset(
    current,
    candidate,
    "BatchSubmitterFunction95B3701F",
  );
  if (fingerprint(expected) !== fingerprint(normalizedCandidate)) {
    throw new Error("Stage B bootstrap submitter는 code asset 밖 변경을 포함할 수 없습니다.");
  }
  return expected;
}

function candidateWithCurrentMetadata(current, candidate) {
  const value = clone(candidate);
  if (current?.Metadata === undefined) delete value.Metadata;
  else value.Metadata = clone(current.Metadata);
  return value;
}

function policyActions(policy) {
  const statements = policy?.Properties?.PolicyDocument?.Statement;
  if (!Array.isArray(statements) || !statements.length) {
    throw new Error("Stage B IAM policy statement가 없습니다.");
  }
  const actions = [];
  for (const statement of statements) {
    const keys = Object.keys(statement || {}).sort();
    if (
      statement?.Effect !== "Allow"
      || !keys.every((key) => ["Action", "Condition", "Effect", "Resource"].includes(key))
      || statement.Action === undefined
      || statement.Resource === undefined
    ) {
      throw new Error("Stage B IAM policy statement가 allowlist 형식과 다릅니다.");
    }
    actions.push(...(Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
  }
  if (new Set(actions).size !== actions.length) {
    throw new Error("Stage B IAM policy에 중복 action이 있습니다.");
  }
  return { statements, actions: actions.sort() };
}

function actionKey(statement) {
  return [...(Array.isArray(statement.Action) ? statement.Action : [statement.Action])]
    .sort().join("|");
}

function statementByActions(statements, actions) {
  const expected = [...actions].sort().join("|");
  const matches = statements.filter((statement) => actionKey(statement) === expected);
  if (matches.length !== 1) {
    throw new Error(`Stage B IAM action group이 정확히 하나가 아닙니다: ${expected}`);
  }
  return matches[0];
}

function exactImportedEditorRepository(resource) {
  const value = JSON.stringify(resource);
  return (
    value.includes("ShortsMvpEditorRepository-production")
    && value.includes("EditorReleaseRepository")
    && !value.includes("*")
  );
}

function exactOidcRole(candidate, options, { verifier }) {
  if (candidate?.Type !== "AWS::IAM::Role") {
    throw new Error("Stage B GitHub OIDC role 형식이 다릅니다.");
  }
  const properties = candidate.Properties || {};
  if (
    !Object.keys(properties).every((key) => (
      ["AssumeRolePolicyDocument", "MaxSessionDuration", "Tags"].includes(key)
    ))
    || properties.MaxSessionDuration !== (verifier ? 7200 : 3600)
    || fingerprint(properties.Tags) !== fingerprint([
      { Key: "Environment", Value: "production" },
      { Key: "ManagedBy", Value: "CDK" },
      { Key: "Project", Value: "shorts-mvp" },
    ])
  ) {
    throw new Error("Stage B GitHub OIDC role 속성이 exact contract와 다릅니다.");
  }
  const statements = properties.AssumeRolePolicyDocument?.Statement;
  if (!Array.isArray(statements) || statements.length !== 1) {
    throw new Error("Stage B GitHub OIDC trust statement가 정확히 하나가 아닙니다.");
  }
  const statement = statements[0];
  const repository = `${options.githubOrg}/${options.githubRepo}`;
  const expectedRef = validateStageBEditorReleaseRef(
    options.githubEditorReleaseRef,
    options.phase,
  );
  const expected = {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": verifier
      ? `repo:${repository}:environment:editor-v4-release-approval`
      : `repo:${repository}:ref:${expectedRef}`,
    "token.actions.githubusercontent.com:ref": expectedRef,
    "token.actions.githubusercontent.com:repository": repository,
    "token.actions.githubusercontent.com:repository_id": String(options.githubRepositoryId),
    "token.actions.githubusercontent.com:repository_owner_id":
      String(options.githubRepositoryOwnerId),
    "token.actions.githubusercontent.com:workflow": "Verify editor release candidate",
    ...(verifier ? {
      "token.actions.githubusercontent.com:environment":
        "editor-v4-release-approval",
    } : {}),
  };
  const principal = statement?.Principal?.Federated;
  const serializedPrincipal = JSON.stringify(principal);
  if (
    statement.Action !== "sts:AssumeRoleWithWebIdentity"
    || statement.Effect !== "Allow"
    || !serializedPrincipal.includes("oidc-provider/token.actions.githubusercontent.com")
    || serializedPrincipal.includes("*")
    || fingerprint(statement.Condition) !== fingerprint({ StringEquals: expected })
  ) {
    throw new Error("Stage B GitHub OIDC trust identity가 exact contract와 다릅니다.");
  }
  return candidate;
}

function exactRegistrarRole(candidate) {
  if (candidate?.Type !== "AWS::IAM::Role") {
    throw new Error("Stage B registrar role 형식이 다릅니다.");
  }
  const properties = candidate.Properties || {};
  const statements = properties.AssumeRolePolicyDocument?.Statement;
  const managed = JSON.stringify(properties.ManagedPolicyArns || []);
  if (
    !Array.isArray(statements)
    || statements.length !== 1
    || fingerprint(statements[0]) !== fingerprint({
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
    })
    || !managed.includes("AWSLambdaBasicExecutionRole")
    || managed.includes("AdministratorAccess")
    || fingerprint(properties.Tags) !== fingerprint([
      { Key: "Environment", Value: "production" },
      { Key: "ManagedBy", Value: "CDK" },
      { Key: "Project", Value: "shorts-mvp" },
    ])
    || !Object.keys(properties).every((key) => (
      ["AssumeRolePolicyDocument", "ManagedPolicyArns", "Tags"].includes(key)
    ))
  ) {
    throw new Error("Stage B registrar role이 최소권한 Lambda role과 다릅니다.");
  }
  return candidate;
}

function exactBuildPolicy(current, candidate) {
  if (candidate?.Type !== "AWS::IAM::Policy") {
    throw new Error("Stage B build policy 형식이 다릅니다.");
  }
  const { actions, statements } = policyActions(candidate);
  const expectedActions = [
    "ecr:BatchCheckLayerAvailability",
    "ecr:BatchGetImage",
    "ecr:CompleteLayerUpload",
    "ecr:DescribeImageScanFindings",
    "ecr:DescribeImages",
    "ecr:GetAuthorizationToken",
    "ecr:GetDownloadUrlForLayer",
    "ecr:InitiateLayerUpload",
    "ecr:PutImage",
    "ecr:UploadLayerPart",
  ].sort();
  const push = statementByActions(statements, [
    "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:UploadLayerPart",
    "ecr:InitiateLayerUpload", "ecr:PutImage",
  ]);
  const auth = statementByActions(statements, ["ecr:GetAuthorizationToken"]);
  const describe = statementByActions(statements, [
    "ecr:DescribeImages", "ecr:DescribeImageScanFindings",
  ]);
  if (
    fingerprint(actions) !== fingerprint(expectedActions)
    || statements.length !== 3
    || statements.some((statement) => statement.Condition !== undefined)
    || !exactImportedEditorRepository(push.Resource)
    || auth.Resource !== "*"
    || !exactImportedEditorRepository(describe.Resource)
    || fingerprint(candidate.Properties.Roles) !== fingerprint([
      { Ref: "EditorReleaseBuildRole111C67A7" },
    ])
  ) {
    throw new Error("Stage B build policy가 ECR build-only 계약과 다릅니다.");
  }
  return candidateWithCurrentMetadata(current, candidate);
}

function exactVerifierPolicy(candidate) {
  if (candidate?.Type !== "AWS::IAM::Policy") {
    throw new Error("Stage B verifier policy 형식이 다릅니다.");
  }
  const { actions, statements } = policyActions(candidate);
  const expectedActions = [
    "batch:DescribeJobDefinitions", "batch:DescribeJobs",
    "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage",
    "ecr:DescribeImageScanFindings", "ecr:DescribeImages",
    "ecr:GetAuthorizationToken", "ecr:GetDownloadUrlForLayer",
    "lambda:InvokeFunction", "s3:GetObject", "s3:GetObjectVersion",
  ].sort();
  const serialized = JSON.stringify(candidate);
  const pull = statementByActions(statements, [
    "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
  ]);
  const auth = statementByActions(statements, ["ecr:GetAuthorizationToken"]);
  const invoke = statementByActions(statements, ["lambda:InvokeFunction"]);
  const batch = statementByActions(statements, [
    "batch:DescribeJobDefinitions", "batch:DescribeJobs",
  ]);
  const describe = statementByActions(statements, [
    "ecr:DescribeImages", "ecr:DescribeImageScanFindings",
  ]);
  const readProbe = statementByActions(statements, [
    "s3:GetObject", "s3:GetObjectVersion",
  ]);
  if (
    fingerprint(actions) !== fingerprint(expectedActions)
    || statements.length !== 6
    || statements.some((statement) => statement.Condition !== undefined)
    || !exactImportedEditorRepository(pull.Resource)
    || auth.Resource !== "*"
    || fingerprint(invoke.Resource) !== fingerprint([
      { "Fn::GetAtt": ["EditorReleaseRegistrarFunctionD787453A", "Arn"] },
      { "Fn::Join": ["", [
        { "Fn::GetAtt": ["EditorReleaseRegistrarFunctionD787453A", "Arn"] },
        ":*",
      ]] },
    ])
    || batch.Resource !== "*"
    || !exactImportedEditorRepository(describe.Resource)
    || !JSON.stringify(readProbe.Resource).includes("editor-release-probes/*")
    || fingerprint(candidate.Properties.Roles) !== fingerprint([
      { Ref: "EditorReleaseVerifierRoleBAFDF9FA" },
    ])
    || !serialized.includes("EditorReleaseRegistrarFunctionD787453A")
    || !serialized.includes("editor-release-probes/*")
    || /batch:(?:SubmitJob|RegisterJobDefinition)|iam:PassRole|s3:PutObject/.test(serialized)
  ) {
    throw new Error("Stage B verifier policy가 read/invoke-only 계약과 다릅니다.");
  }
  return candidate;
}

function exactRegistrarPolicy(candidate, options) {
  if (candidate?.Type !== "AWS::IAM::Policy") {
    throw new Error("Stage B registrar policy 형식이 다릅니다.");
  }
  const { actions, statements } = policyActions(candidate);
  const expectedActions = [
    "batch:DescribeJobDefinitions", "batch:DescribeJobs", "batch:ListJobs",
    "batch:RegisterJobDefinition", "batch:SubmitJob", "batch:TagResource",
    "ecr:DescribeImageScanFindings", "ecr:DescribeImages", "iam:PassRole",
    "s3:GetObject", "s3:GetObjectVersion", "secretsmanager:DescribeSecret",
    "secretsmanager:GetSecretValue",
  ].sort();
  const secret = statementByActions(statements, [
    "secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret",
  ]);
  const ecr = statementByActions(statements, [
    "ecr:DescribeImageScanFindings", "ecr:DescribeImages",
  ]);
  const s3 = statementByActions(statements, ["s3:GetObject", "s3:GetObjectVersion"]);
  const batchReadRegister = statementByActions(statements, [
    "batch:DescribeJobDefinitions", "batch:DescribeJobs", "batch:ListJobs",
    "batch:RegisterJobDefinition",
  ]);
  const submit = statementByActions(statements, ["batch:SubmitJob"]);
  const tag = statementByActions(statements, ["batch:TagResource"]);
  const passRole = statementByActions(statements, ["iam:PassRole"]);
  const serialized = JSON.stringify(candidate);
  if (
    fingerprint(actions) !== fingerprint(expectedActions)
    || statements.length !== 7
    || !JSON.stringify(secret.Resource).includes("WorkerRuntimeSecret")
    || !exactImportedEditorRepository(ecr.Resource)
    || !JSON.stringify(s3.Resource).includes("editor-release-probes/*")
    || batchReadRegister.Resource !== "*"
    || !JSON.stringify(submit.Resource).includes("shorts-mvp-editor-test")
    || !JSON.stringify(submit.Resource).includes("shorts-mvp-editor-test-release-*")
    || !Array.isArray(tag.Resource)
    || tag.Resource.length !== 4
    || !tag.Resource.some((resource) => (
      JSON.stringify(resource).includes("job-queue/shorts-mvp-editor-test")
    ))
    || fingerprint(passRole?.Resource) !== fingerprint(
      [...(options.registrarPassRoleArns || [])].sort(),
    )
    || fingerprint(passRole?.Condition) !== fingerprint({
      StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
    })
    || fingerprint(candidate.Properties.Roles) !== fingerprint([
      { Ref: "EditorReleaseRegistrarRole9129B368" },
    ])
    || !serialized.includes("shorts-mvp-editor-test-release-*")
    || !serialized.includes("shorts-mvp-editor-release-*")
    || !serialized.includes("shorts-mvp-editor-v4-*")
    || !serialized.includes("editor-release-probes/*")
    || serialized.includes("AdministratorAccess")
  ) {
    throw new Error("Stage B registrar policy가 exact mutation allowlist와 다릅니다.");
  }
  return candidate;
}

function resolveSimpleCloudFormationString(value, tokens) {
  if (typeof value === "string") return value;
  const join = value?.["Fn::Join"];
  if (!Array.isArray(join) || join.length !== 2 || typeof join[0] !== "string") {
    return null;
  }
  const parts = join[1];
  if (!Array.isArray(parts)) return null;
  const resolved = [];
  for (const part of parts) {
    if (typeof part === "string") {
      resolved.push(part);
      continue;
    }
    const ref = part?.Ref;
    if (typeof ref !== "string" || !Object.hasOwn(tokens, ref)) return null;
    resolved.push(tokens[ref]);
  }
  return resolved.join(join[0]);
}

function exactRegistrarEnvironment(currentVariables, candidateVariables, options) {
  const expectedKeys = [
    "EDITOR_CANARY_BATCH_QUEUE", "EDITOR_RELEASE_ECR_REPOSITORY_URI",
    "EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS", "EDITOR_STABLE_BATCH_QUEUE",
    "EDITOR_TEST_BUCKET_NAME", "EDITOR_TEST_EXECUTION_ROLE_ARN",
    "EDITOR_TEST_JOB_QUEUE_ARN", "EDITOR_TEST_TASK_ROLE_ARN",
    "EDITOR_TEST_TEMPLATE_JOB_DEFINITION", "EDITOR_WORK_DISPATCH_QUEUE_URL",
    "GITHUB_OIDC_AUDIENCE", "GITHUB_OIDC_ENVIRONMENT", "GITHUB_OIDC_RELEASE_TAG",
    "GITHUB_OIDC_REPOSITORY", "GITHUB_OIDC_REPOSITORY_ID",
    "GITHUB_OIDC_REPOSITORY_OWNER_ID", "GITHUB_OIDC_WORKFLOW_NAME",
    "GITHUB_OIDC_WORKFLOW_PATH", "MEDIA_BUCKET", "PROJECT_BATCH_QUEUE",
    "PROJECT_TARGET_REGISTRY_PATH", "RERENDER_JOB_DEFINITION",
    "RUNTIME_SECRET_ARN", "WORK_DISPATCH_QUEUE_URL",
  ].sort();
  if (fingerprint(Object.keys(candidateVariables).sort()) !== fingerprint(expectedKeys)) {
    throw new Error("Stage B registrar environment key 집합이 exact contract와 다릅니다.");
  }
  for (const key of [
    "RUNTIME_SECRET_ARN", "MEDIA_BUCKET", "EDITOR_WORK_DISPATCH_QUEUE_URL",
    "WORK_DISPATCH_QUEUE_URL",
  ]) {
    if (fingerprint(candidateVariables[key]) !== fingerprint(currentVariables[key])) {
      throw new Error(`Stage B registrar 기존 환경값이 변경되었습니다: ${key}`);
    }
  }
  const exactScalars = {
    PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
    GITHUB_OIDC_AUDIENCE: "editor-v4-release-registrar",
    GITHUB_OIDC_ENVIRONMENT: "editor-v4-release-approval",
    GITHUB_OIDC_RELEASE_TAG: STAGE_B_EDITOR_RELEASE_REF.replace(/^refs\/tags\//, ""),
    GITHUB_OIDC_REPOSITORY: `${options.githubOrg}/${options.githubRepo}`,
    GITHUB_OIDC_REPOSITORY_ID: String(options.githubRepositoryId),
    GITHUB_OIDC_REPOSITORY_OWNER_ID: String(options.githubRepositoryOwnerId),
    GITHUB_OIDC_WORKFLOW_NAME: "Verify editor release candidate",
    GITHUB_OIDC_WORKFLOW_PATH: ".github/workflows/editor-release.yml",
    EDITOR_TEST_TEMPLATE_JOB_DEFINITION: "shorts-mvp-editor-test-template",
    EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS: JSON.stringify(
      [...(options.registrarPassRoleArns || [])].sort(),
    ),
  };
  for (const [key, value] of Object.entries(exactScalars)) {
    if (candidateVariables[key] !== value) {
      throw new Error(`Stage B registrar 환경값이 exact contract와 다릅니다: ${key}`);
    }
  }
  const legacyQueue = options.projectTargets?.lanes?.legacy_project?.current?.jobQueueArn;
  const identity = /^arn:(aws(?:-[a-z]+)*):batch:([a-z0-9-]+):([0-9]{12}):job-queue\//
    .exec(String(legacyQueue || ""));
  if (!identity) {
    throw new Error("Stage B registry legacy queue identity가 올바르지 않습니다.");
  }
  const [, partition, region, account] = identity;
  const tokens = {
    "AWS::Partition": partition,
    "AWS::Region": region,
    "AWS::AccountId": account,
  };
  const resolve = (value) => resolveSimpleCloudFormationString(value, tokens);
  const rerender = resolve(candidateVariables.RERENDER_JOB_DEFINITION);
  const repositoryValue = candidateVariables.EDITOR_RELEASE_ECR_REPOSITORY_URI;
  const repositoryUri = resolve(repositoryValue);
  const repositorySerialized = JSON.stringify(repositoryValue);
  const literalRepositoryPattern = new RegExp(
    `^${account}\\.dkr\\.ecr\\.${region}\\.amazonaws\\.com\\/[a-z0-9][a-z0-9._/-]*$`,
  );
  const exactRepositoryUri = (
    typeof repositoryUri === "string"
    && literalRepositoryPattern.test(repositoryUri)
  ) || (
    repositoryUri == null
    && repositorySerialized.includes("EditorReleaseRepository")
    && repositorySerialized.includes("dkr.ecr")
  );
  if (
    resolve(candidateVariables.PROJECT_BATCH_QUEUE) !== legacyQueue
    || resolve(candidateVariables.EDITOR_STABLE_BATCH_QUEUE) !== legacyQueue
    || fingerprint(candidateVariables.EDITOR_CANARY_BATCH_QUEUE) !== fingerprint({
      "Fn::GetAtt": ["EditorCanaryQueue", "JobQueueArn"],
    })
    || rerender !== `arn:${partition}:batch:${region}:${account}:job-definition/shorts-mvp-rerender-fargate-production:${rerender.split(":").at(-1)}`
    || !/:[1-9][0-9]*$/.test(rerender)
    || resolve(candidateVariables.EDITOR_TEST_JOB_QUEUE_ARN)
      !== `arn:${partition}:batch:${region}:${account}:job-queue/shorts-mvp-editor-test`
    || resolve(candidateVariables.EDITOR_TEST_TASK_ROLE_ARN)
      !== `arn:${partition}:iam::${account}:role/shorts-mvp-editor-test-task`
    || resolve(candidateVariables.EDITOR_TEST_EXECUTION_ROLE_ARN)
      !== `arn:${partition}:iam::${account}:role/shorts-mvp-editor-test-execution`
    || resolve(candidateVariables.EDITOR_TEST_BUCKET_NAME)
      !== `shorts-mvp-editor-test-${account}-${region}`
    || !exactRepositoryUri
  ) {
    throw new Error("Stage B registrar AWS target 환경값이 exact ARN 계약과 다릅니다.");
  }
}

function exactSharedEditorRolePolicyReduction(current, candidate) {
  if (current?.Type !== "AWS::IAM::Policy" || candidate?.Type !== "AWS::IAM::Policy") {
    throw new Error("Stage B shared editor Lambda policy 형식이 다릅니다.");
  }
  const currentStatements = current.Properties?.PolicyDocument?.Statement;
  if (!Array.isArray(currentStatements)) {
    throw new Error("Stage B shared editor Lambda policy statement가 없습니다.");
  }
  const removableActions = new Set([
    "ecr:DescribeImageScanFindings",
    "s3:GetObject",
  ]);
  const removed = currentStatements.filter((statement) => (
    removableActions.has(actionKey(statement))
  ));
  if (
    removed.length !== 2
    || new Set(removed.map(actionKey)).size !== 2
    || removed.some((statement) => statement.Effect !== "Allow")
  ) {
    throw new Error("Stage B shared role의 기존 probe 권한 두 항목을 식별할 수 없습니다.");
  }
  const expected = clone(current);
  expected.Properties.PolicyDocument.Statement = currentStatements.filter(
    (statement) => !removableActions.has(actionKey(statement)),
  );
  const normalizedCandidate = candidateWithCurrentMetadata(current, candidate);
  if (fingerprint(expected) !== fingerprint(normalizedCandidate)) {
    throw new Error("Stage B shared role은 기존 probe 권한 두 항목만 제거할 수 있습니다.");
  }
  return expected;
}

function exactBootstrapRegistrar(current, candidate, options) {
  const { normalizedCandidate } = copyLambdaAsset(
    current, candidate, "EditorReleaseRegistrarFunctionD787453A",
  );
  const currentVariables = current.Properties?.Environment?.Variables;
  const candidateVariables = candidate.Properties?.Environment?.Variables;
  if (!currentVariables || !candidateVariables) {
    throw new Error("Editor registrar Lambda environment가 없습니다.");
  }
  exactRegistrarEnvironment(currentVariables, candidateVariables, options);
  const stableProperties = ["FunctionName", "Handler", "Runtime", "Tags"];
  for (const key of stableProperties) {
    if (fingerprint(current.Properties[key]) !== fingerprint(candidate.Properties[key])) {
      throw new Error(`Stage B registrar 불변 속성이 변경되었습니다: ${key}`);
    }
  }
  if (
    candidate.Properties.MemorySize !== 512
    || candidate.Properties.Timeout !== 300
    || fingerprint(candidate.Properties.Role) !== fingerprint({
      "Fn::GetAtt": ["EditorReleaseRegistrarRole9129B368", "Arn"],
    })
    || fingerprint(candidate.DependsOn) !== fingerprint([
      "EditorReleaseRegistrarRoleDefaultPolicy3320C259",
      "EditorReleaseRegistrarRole9129B368",
    ])
    || !Object.keys(candidate.Properties).every((key) => (
      [
        "Code", "Environment", "FunctionName", "Handler", "MemorySize",
        "Role", "Runtime", "Tags", "Timeout",
      ].includes(key)
    ))
  ) {
    throw new Error("Stage B registrar Lambda가 dedicated-role exact contract와 다릅니다.");
  }
  return normalizedCandidate;
}

function exactRotationRegistrar(current, candidate) {
  const { expected, normalizedCandidate } = copyLambdaAsset(
    current,
    candidate,
    "EditorReleaseRegistrarFunctionD787453A",
  );
  if (fingerprint(expected) !== fingerprint(normalizedCandidate)) {
    throw new Error("Stage B rotation registrar는 registry asset 밖 변경을 포함할 수 없습니다.");
  }
  return expected;
}

function canonicalRotationTargetEnvironment(projectTargetsValue) {
  const registry = validateProductionProjectTargets(
    projectTargetsValue || readProductionProjectTargets(),
  );
  const lane = registry.lanes;
  const values = {
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
  };
  if (lane.unified_template_subtitles.previous) {
    values.UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN =
      lane.unified_template_subtitles.previous.jobDefinitionArn;
  }
  return values;
}

function exactRotationBatchSubmitter(current, candidate, options) {
  const { expected, normalizedCandidate } = copyLambdaAsset(
    current,
    candidate,
    "BatchSubmitterFunction95B3701F",
  );
  const currentVariables = current.Properties?.Environment?.Variables;
  const candidateVariables = candidate.Properties?.Environment?.Variables;
  if (!currentVariables || !candidateVariables) {
    throw new Error("Batch submitter Lambda environment가 없습니다.");
  }
  const expectedVariables = clone(currentVariables);
  for (const key of TARGET_ENVIRONMENT_KEYS) delete expectedVariables[key];
  Object.assign(
    expectedVariables,
    canonicalRotationTargetEnvironment(options.projectTargets),
  );
  expected.Properties.Environment = clone(current.Properties.Environment);
  expected.Properties.Environment.Variables = expectedVariables;
  if (fingerprint(expected) !== fingerprint(normalizedCandidate)) {
    throw new Error(
      "Stage B rotation submitter는 registry asset/exact target env 밖 변경을 포함할 수 없습니다.",
    );
  }
  return expected;
}

function exactResource(phase, stackKey, logicalId, current, candidate, options) {
  if (phase === "bootstrap" && stackKey === "compute") {
    return exactBootstrapBatchSubmitter(current, candidate);
  }
  if (phase === "bootstrap" && logicalId === "EditorReleaseRegistrarFunctionD787453A") {
    return exactBootstrapRegistrar(current, candidate, options);
  }
  if (phase === "renewal" && logicalId === "EditorReleaseRegistrarFunctionD787453A") {
    return exactBootstrapRegistrar(current, candidate, options);
  }
  if (
    phase === "bootstrap"
    && logicalId === "EditorCanaryLambdaRoleDefaultPolicy2BA45784"
  ) {
    return exactSharedEditorRolePolicyReduction(current, candidate);
  }
  if (phase === "bootstrap" && logicalId === "EditorReleaseRegistrarRole9129B368") {
    return exactRegistrarRole(candidate);
  }
  if (
    ["bootstrap", "renewal"].includes(phase)
    && logicalId === "EditorReleaseRegistrarRoleDefaultPolicy3320C259"
  ) {
    return exactRegistrarPolicy(candidate, options);
  }
  if (
    ["bootstrap", "renewal"].includes(phase)
    && logicalId === "EditorReleaseVerifierRoleBAFDF9FA"
  ) {
    return candidateWithCurrentMetadata(
      current,
      exactOidcRole(candidate, options, { verifier: true }),
    );
  }
  if (
    phase === "bootstrap"
    && logicalId === "EditorReleaseVerifierRoleDefaultPolicy97A1748C"
  ) {
    return exactVerifierPolicy(candidate);
  }
  if (phase === "rotation" && stackKey === "compute") {
    return exactRotationBatchSubmitter(current, candidate, options);
  }
  if (phase === "rotation" && logicalId === "EditorReleaseRegistrarFunctionD787453A") {
    return exactRotationRegistrar(current, candidate);
  }
  if (logicalId === "EditorReleaseBuildRole111C67A7") {
    return candidateWithCurrentMetadata(
      current,
      exactOidcRole(candidate, options, { verifier: false }),
    );
  }
  if (logicalId === "EditorReleaseBuildRoleDefaultPolicyF82DF532") {
    if (phase !== "bootstrap") {
      throw new Error(`Stage B allowlist 밖 build policy 단계입니다: ${phase}`);
    }
    return exactBuildPolicy(current, candidate);
  }
  throw new Error(`Stage B allowlist 밖 logical ID입니다: ${logicalId}`);
}

export function buildExactStageBTemplate(
  phaseValue,
  stackKey,
  currentTemplate,
  fullCandidateTemplate,
  options = {},
) {
  const contract = contractFor(phaseValue, stackKey);
  const expectedEnvelope = exactTemplateEnvelope(
    contract.phase,
    stackKey,
    currentTemplate,
    fullCandidateTemplate,
  );
  const current = resources(currentTemplate);
  const candidate = resources(fullCandidateTemplate);
  const fullChanges = stageBTemplateResourceChanges(currentTemplate, fullCandidateTemplate);
  for (const change of fullChanges) {
    const allowedType = contract.resources[change.logicalId];
    if (
      !allowedType
      || change.action !== expectedResourceAction(
        contract.phase,
        stackKey,
        change.logicalId,
      )
      || change.type !== allowedType
    ) {
      throw new Error(
        `Stage B ${contract.phase} 범위 밖 변경입니다: ${change.action} ${change.logicalId} (${change.type})`,
      );
    }
  }
  validateContractChangeCompleteness(
    contract,
    fullChanges.map((change) => change.logicalId),
    "필수 변경",
  );
  const exact = clone(currentTemplate);
  for (const key of Object.keys(exact)) {
    if (key !== "Resources") delete exact[key];
  }
  Object.assign(exact, expectedEnvelope);
  for (const { logicalId } of fullChanges) {
    exact.Resources[logicalId] = exactResource(
      contract.phase,
      stackKey,
      logicalId,
      current[logicalId],
      candidate[logicalId],
      options,
    );
  }
  validateExactStageBTemplate(
    contract.phase,
    stackKey,
    currentTemplate,
    exact,
    options,
  );
  return exact;
}

export function validateExactStageBTemplate(
  phaseValue,
  stackKey,
  currentTemplate,
  candidateTemplate,
  options = {},
) {
  const contract = contractFor(phaseValue, stackKey);
  exactTemplateEnvelope(
    contract.phase,
    stackKey,
    currentTemplate,
    candidateTemplate,
  );
  const changes = stageBTemplateResourceChanges(currentTemplate, candidateTemplate);
  const seen = new Set();
  for (const change of changes) {
    const expectedType = contract.resources[change.logicalId];
    if (
      !expectedType
      || change.action !== expectedResourceAction(
        contract.phase,
        stackKey,
        change.logicalId,
      )
      || change.type !== expectedType
    ) {
      throw new Error(
        `Stage B ${contract.phase} exact template 범위 밖 변경입니다: ${change.logicalId}`,
      );
    }
    exactResource(
      contract.phase,
      stackKey,
      change.logicalId,
      change.before,
      change.after,
      options,
    );
    if (seen.has(change.logicalId)) {
      throw new Error(`Stage B exact template에 중복 변경이 있습니다: ${change.logicalId}`);
    }
    seen.add(change.logicalId);
  }
  validateContractChangeCompleteness(
    contract,
    seen,
    "exact template 변경",
  );
  return changes.map(({ before: _before, after: _after, ...change }) => change);
}

export function validateAppliedStageBTemplate(
  phaseValue,
  stackKey,
  liveTemplate,
  fullCandidateTemplate,
  options = {},
) {
  const contract = contractFor(phaseValue, stackKey);
  if (
    fingerprint(templateEnvelope(liveTemplate))
    !== fingerprint(templateEnvelope(fullCandidateTemplate))
  ) {
    throw new Error("Stage B applied template envelope가 exact HEAD 후보와 다릅니다.");
  }
  const live = resources(liveTemplate);
  const candidate = resources(fullCandidateTemplate);
  for (const [logicalId, expectedType] of Object.entries(contract.resources)) {
    if (!live[logicalId] || !candidate[logicalId]) {
      throw new Error(`Stage B applied template resource가 없습니다: ${logicalId}`);
    }
    if (
      live[logicalId].Type !== expectedType
      || candidate[logicalId].Type !== expectedType
    ) {
      throw new Error(`Stage B applied template resource type이 다릅니다: ${logicalId}`);
    }
    const expected = clone(candidate[logicalId]);
    if (live[logicalId].Metadata === undefined) delete expected.Metadata;
    else expected.Metadata = clone(live[logicalId].Metadata);
    if (fingerprint(expected) !== fingerprint(live[logicalId])) {
      throw new Error(
        `Stage B ${contract.phase}/${stackKey} live resource가 exact HEAD 후보와 다릅니다: ${logicalId}`,
      );
    }
  }
  return Object.keys(contract.resources);
}

export function validatePreparedStageBChangeSet(phaseValue, stackKey, changeSet) {
  const contract = contractFor(phaseValue, stackKey);
  const propertyContracts = PHASE_PROPERTY_CONTRACTS[contract.phase][stackKey];
  if (
    changeSet?.StackName !== contract.stackName
    || ![undefined, "UPDATE"].includes(changeSet?.ChangeSetType)
    || changeSet?.Status !== "CREATE_COMPLETE"
    || changeSet?.ExecutionStatus !== "AVAILABLE"
  ) {
    throw new Error([
      "Stage B change set이 exact stack의 실행 가능 UPDATE preview가 아닙니다.",
      `stack=${String(changeSet?.StackName || "")}`,
      `type=${String(changeSet?.ChangeSetType || "")}`,
      `status=${String(changeSet?.Status || "")}`,
      `execution=${String(changeSet?.ExecutionStatus || "")}`,
    ].join(" "));
  }
  const seen = new Set();
  for (const row of changeSet.Changes || []) {
    const change = row?.ResourceChange || {};
    const logicalId = String(change.LogicalResourceId || "");
    const expectedAction = expectedResourceAction(
      contract.phase,
      stackKey,
      logicalId,
    );
    if (
      change.Action !== (expectedAction === "add" ? "Add" : "Modify")
      || change.ResourceType !== contract.resources[logicalId]
      || (expectedAction === "add"
        ? ![undefined, null, "False"].includes(change.Replacement)
        : change.Replacement !== "False")
      || seen.has(logicalId)
    ) {
      throw new Error(`Stage B change set 범위/교체 계약 위반: ${logicalId}`);
    }
    if (expectedAction === "add") {
      if (
        (change.Scope !== undefined
          && (!Array.isArray(change.Scope) || change.Scope.length !== 0))
        || (change.Details !== undefined
          && (!Array.isArray(change.Details) || change.Details.length !== 0))
      ) {
        throw new Error(`Stage B added resource preview 계약 위반: ${logicalId}`);
      }
      seen.add(logicalId);
      continue;
    }
    if (
      !Array.isArray(change.Scope)
      || change.Scope.length !== 1
      || change.Scope[0] !== "Properties"
      || !Array.isArray(change.Details)
      || change.Details.length === 0
    ) {
      throw new Error(`Stage B change set Scope/Details 계약 위반: ${logicalId}`);
    }
    const allowedProperties = new Set(propertyContracts[logicalId] || []);
    const registrarRoleDetails = (
      contract.phase === "bootstrap"
      && stackKey === "editor"
      && logicalId === "EditorReleaseRegistrarFunctionD787453A"
    ) ? change.Details.filter((detail) => detail?.Target?.Name === "Role") : [];
    const registrarRoleDetailKeys = new Set(registrarRoleDetails.map((detail) => (
      [
        String(detail.ChangeSource || ""),
        String(detail.Evaluation || ""),
        String(detail.CausingEntity || ""),
      ].join("|")
    )));
    if (
      registrarRoleDetails.length > 0
      && (
        registrarRoleDetails.length !== 2
        || registrarRoleDetailKeys.size !== 2
        || !registrarRoleDetailKeys.has("DirectModification|Dynamic|")
        || !registrarRoleDetailKeys.has(
          "ResourceAttribute|Static|EditorReleaseRegistrarRole9129B368.Arn",
        )
      )
    ) {
      throw new Error("Stage B registrar Role dependency detail 집합이 exact contract와 다릅니다.");
    }
    for (const detail of change.Details) {
      const target = detail?.Target || {};
      const isRegistrarRole = (
        contract.phase === "bootstrap"
        && stackKey === "editor"
        && logicalId === "EditorReleaseRegistrarFunctionD787453A"
        && target.Name === "Role"
      );
      const exactChangeSource = isRegistrarRole
        ? registrarRoleDetailKeys.has([
            String(detail.ChangeSource || ""),
            String(detail.Evaluation || ""),
            String(detail.CausingEntity || ""),
          ].join("|"))
        : detail.ChangeSource === "DirectModification"
          && [undefined, null, ""].includes(detail.CausingEntity);
      if (
        target.Attribute !== "Properties"
        || !allowedProperties.has(String(target.Name || ""))
        || !["Modify", "Add", "Remove"].includes(target.AttributeChangeType)
        || target.RequiresRecreation !== "Never"
        || (!isRegistrarRole && detail.Evaluation !== "Static")
        || !exactChangeSource
      ) {
        throw new Error([
          `Stage B change set property detail 계약 위반: ${logicalId}`,
          `attribute=${String(target.Attribute || "")}`,
          `name=${String(target.Name || "")}`,
          `changeType=${String(target.AttributeChangeType || "")}`,
          `recreation=${String(target.RequiresRecreation || "")}`,
          `evaluation=${String(detail?.Evaluation || "")}`,
          `source=${String(detail?.ChangeSource || "")}`,
          `causing=${String(detail?.CausingEntity || "")}`,
        ].join(" "));
      }
    }
    seen.add(logicalId);
  }
  validateContractChangeCompleteness(contract, seen, "change set 변경");
  return changeSet;
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length < 4 || argv.length > 5) {
    throw new Error(
      "usage: verify-stage-b-release-control-template-diff.mjs bootstrap|renewal|rotation|lockdown editor|compute current.json candidate.json [exact-ref]",
    );
  }
  const [phase, stackKey, currentPath, candidatePath, ref] = argv;
  const exactRef = ref
    || STAGE_B_PHASE_CONTRACTS[validateStageBPhase(phase)].editorReleaseRef;
  const current = JSON.parse(fs.readFileSync(path.resolve(currentPath), "utf8"));
  const candidate = JSON.parse(fs.readFileSync(path.resolve(candidatePath), "utf8"));
  let registrarPassRoleArns = [];
  if (process.env.STAGE_B_REGISTRAR_PASS_ROLE_ARNS) {
    registrarPassRoleArns = JSON.parse(process.env.STAGE_B_REGISTRAR_PASS_ROLE_ARNS);
    if (!Array.isArray(registrarPassRoleArns)) {
      throw new Error("STAGE_B_REGISTRAR_PASS_ROLE_ARNS는 JSON 배열이어야 합니다.");
    }
  }
  const changes = validateExactStageBTemplate(phase, stackKey, current, candidate, {
    githubOrg: process.env.GITHUB_ORG || "dongk176",
    githubRepo: process.env.GITHUB_REPO || "shorts",
    githubEditorReleaseRef: exactRef,
    githubRepositoryId: process.env.GITHUB_REPOSITORY_ID || "",
    githubRepositoryOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID || "",
    registrarPassRoleArns,
    projectTargets: readProductionProjectTargets(),
  });
  process.stdout.write(
    `Stage B ${phase}/${stackKey} exact template 검증 완료: ${changes.length}개 변경\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
