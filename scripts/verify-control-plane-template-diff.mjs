#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROJECT_TARGET_LANES,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";

export const CONTROL_PLANE_RESOURCE_CHANGES = Object.freeze({
  BatchSubmitterFunction95B3701F: { action: "update", type: "AWS::Lambda::Function" },
  BatchStateFunction2DEF92D9: { action: "update", type: "AWS::Lambda::Function" },
  CleanupFunction1604930F: { action: "update", type: "AWS::Lambda::Function" },
  OutboxDispatcherFunction7D53F71C: { action: "update", type: "AWS::Lambda::Function" },
  BatchSubmitterLogsA1DC739B: { action: "add", type: "AWS::Logs::LogGroup" },
  BatchSubmitterFailureMetric3C910ADE: { action: "add", type: "AWS::Logs::MetricFilter" },
  BatchTargetTrustRejectedMetricAA20989D: { action: "add", type: "AWS::Logs::MetricFilter" },
  BatchTargetUnknownReleaseMetric201A6AA1: { action: "add", type: "AWS::Logs::MetricFilter" },
  QueuedWithoutBatchIdMetric9DFC10D7: { action: "add", type: "AWS::Logs::MetricFilter" },
  ProjectDispatchHealthCheckFailedMetricD9F8DEA1: { action: "add", type: "AWS::Logs::MetricFilter" },
  BatchSubmissionReconciliationRequiredMetric6415C254: { action: "add", type: "AWS::Logs::MetricFilter" },
  BatchSubmitterFailureAlarm9EBC0935: { action: "add", type: "AWS::CloudWatch::Alarm" },
  BatchTargetTrustRejectedAlarmA152BA82: { action: "add", type: "AWS::CloudWatch::Alarm" },
  BatchTargetUnknownReleaseAlarm761180F2: { action: "add", type: "AWS::CloudWatch::Alarm" },
  QueuedWithoutBatchIdAlarmE8CE7465: { action: "add", type: "AWS::CloudWatch::Alarm" },
  ProjectDispatchHealthCheckFailedAlarmF411030C: { action: "add", type: "AWS::CloudWatch::Alarm" },
  BatchSubmissionReconciliationRequiredAlarm9F01E7EB: { action: "add", type: "AWS::CloudWatch::Alarm" },
  BatchSubmitterLambdaErrorAlarm829AEAB9: { action: "add", type: "AWS::CloudWatch::Alarm" },
  WorkDispatchDlqAlarm119DCF63: { action: "add", type: "AWS::CloudWatch::Alarm" },
});

const PACKAGING_ONLY_LAMBDA_DRIFT = new Set([
  "StateWriterFunctionB9BD747D",
]);

const BATCH_SUBMITTER_FUNCTION = "BatchSubmitterFunction95B3701F";
const BATCH_STATE_FUNCTION = "BatchStateFunction2DEF92D9";
const CLEANUP_FUNCTION = "CleanupFunction1604930F";
const OUTBOX_DISPATCHER_FUNCTION = "OutboxDispatcherFunction7D53F71C";
const ASSET_METADATA_KEYS = ["aws:asset:path", "aws:asset:is-bundled"];

export const BATCH_SUBMITTER_CANONICAL_TARGETS = Object.freeze({
  PREPARE_JOB_DEFINITION: {
    "Fn::GetAtt": ["PrepareJobDefinition", "JobDefinitionArn"],
  },
  RENDER_JOB_DEFINITION: {
    "Fn::GetAtt": ["RenderJobDefinition", "JobDefinitionArn"],
  },
  RERENDER_JOB_DEFINITION: {
    "Fn::GetAtt": ["RerenderFargateJobDefinition", "JobDefinitionArn"],
  },
});

function canonicalProjectTargetEnvironment() {
  const registry = readProductionProjectTargets();
  const environment = {};
  for (const [laneName, prefix] of Object.entries(PROJECT_TARGET_LANES)) {
    const lane = registry.lanes[laneName];
    environment[`${prefix}_JOB_DEFINITION_ARN`] =
      lane.current.jobDefinitionArn;
    environment[`${prefix}_BATCH_QUEUE_ARN`] = lane.current.jobQueueArn;
    if (lane.previous) {
      environment[`${prefix}_PREVIOUS_JOB_DEFINITION_ARN`] =
        lane.previous.jobDefinitionArn;
    }
  }
  return environment;
}

export const BATCH_SUBMITTER_CANONICAL_PROJECT_TARGETS = Object.freeze(
  canonicalProjectTargetEnvironment(),
);

export const PRESERVED_BATCH_DEFINITION_DRIFT = new Set([
  "LongJobDefinition",
  "PrepareJobDefinition",
  "ProjectFargateJobDefinition",
  "ProjectHeavyFargateJobDefinition",
  "RenderJobDefinition",
  "RerenderFargateJobDefinition",
  "ShortJobDefinition",
]);

const CONTROL_PLANE_TAGS = Object.freeze([
  { Key: "Environment", Value: "production" },
  { Key: "ManagedBy", Value: "CDK" },
  { Key: "Project", Value: "shorts-mvp" },
]);

const METRIC_FILTER_CONTRACTS = Object.freeze({
  BatchSubmitterFailureMetric3C910ADE: {
    path: "BatchSubmitterFailureMetric",
    pattern: "{ $.event = \"batch_submit_failed\" }",
    logGroup: "BatchSubmitterLogsA1DC739B",
    metric: "BatchSubmitterFailure",
  },
  BatchTargetTrustRejectedMetricAA20989D: {
    path: "BatchTargetTrustRejectedMetric",
    pattern: "{ $.event = \"project_target_trust_rejected\" }",
    logGroup: "BatchSubmitterLogsA1DC739B",
    metric: "BatchTargetTrustRejected",
  },
  BatchTargetUnknownReleaseMetric201A6AA1: {
    path: "BatchTargetUnknownReleaseMetric",
    pattern: "{ $.event = \"project_target_release_unknown\" }",
    logGroup: "BatchSubmitterLogsA1DC739B",
    metric: "BatchTargetUnknownRelease",
  },
  QueuedWithoutBatchIdMetric9DFC10D7: {
    path: "QueuedWithoutBatchIdMetric",
    pattern: "{ $.event = \"queued_without_batch_id\" }",
    logGroup: "CleanupLogs0F08F816",
    metric: "QueuedWithoutBatchId",
  },
  ProjectDispatchHealthCheckFailedMetricD9F8DEA1: {
    path: "ProjectDispatchHealthCheckFailedMetric",
    pattern: "{ $.event = \"project_dispatch_health_check_failed\" }",
    logGroup: "CleanupLogs0F08F816",
    metric: "ProjectDispatchHealthCheckFailed",
  },
  BatchSubmissionReconciliationRequiredMetric6415C254: {
    path: "BatchSubmissionReconciliationRequiredMetric",
    pattern: "{ $.event = \"batch_submission_reconciliation_required\" }",
    logGroup: "CleanupLogs0F08F816",
    metric: "BatchSubmissionReconciliationRequired",
  },
});

const ALARM_CONTRACTS = Object.freeze({
  BatchSubmitterFailureAlarm9EBC0935: {
    path: "BatchSubmitterFailureAlarm",
    alarmName: "shorts-mvp-production-batch-submitter-failure",
    metric: "BatchSubmitterFailure",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  BatchTargetTrustRejectedAlarmA152BA82: {
    path: "BatchTargetTrustRejectedAlarm",
    alarmName: "shorts-mvp-production-batch-target-trust-rejected",
    metric: "BatchTargetTrustRejected",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  BatchTargetUnknownReleaseAlarm761180F2: {
    path: "BatchTargetUnknownReleaseAlarm",
    alarmName: "shorts-mvp-production-batch-target-unknown-release",
    metric: "BatchTargetUnknownRelease",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  QueuedWithoutBatchIdAlarmE8CE7465: {
    path: "QueuedWithoutBatchIdAlarm",
    alarmName: "shorts-mvp-production-queued-without-batch-id",
    metric: "QueuedWithoutBatchId",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  ProjectDispatchHealthCheckFailedAlarmF411030C: {
    path: "ProjectDispatchHealthCheckFailedAlarm",
    alarmName: "shorts-mvp-production-project-dispatch-health-check-failed",
    metric: "ProjectDispatchHealthCheckFailed",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  BatchSubmissionReconciliationRequiredAlarm9F01E7EB: {
    path: "BatchSubmissionReconciliationRequiredAlarm",
    alarmName: "shorts-mvp-production-batch-submission-reconciliation-required",
    metric: "BatchSubmissionReconciliationRequired",
    namespace: "ShortsMvp/production",
    statistic: "Sum",
  },
  BatchSubmitterLambdaErrorAlarm829AEAB9: {
    path: "BatchSubmitterLambdaErrorAlarm",
    alarmName: "shorts-mvp-production-batch-submitter-lambda-error",
    metric: "Errors",
    namespace: "AWS/Lambda",
    statistic: "Sum",
    dimensions: [{
      Name: "FunctionName",
      Value: { Ref: "BatchSubmitterFunction95B3701F" },
    }],
  },
  WorkDispatchDlqAlarm119DCF63: {
    path: "WorkDispatchDlqAlarm",
    alarmName: "shorts-mvp-production-work-dispatch-dlq",
    metric: "ApproximateNumberOfMessagesVisible",
    namespace: "AWS/SQS",
    statistic: "Maximum",
    dimensions: [{
      Name: "QueueName",
      Value: { "Fn::GetAtt": ["WorkDispatchDlqFA34A0F9", "QueueName"] },
    }],
  },
});

export function canonicalAddedControlPlaneResource(logicalId) {
  if (logicalId === "BatchSubmitterLogsA1DC739B") {
    return {
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: "/shorts-mvp/production/batch-submitter",
        RetentionInDays: 14,
        Tags: clone(CONTROL_PLANE_TAGS),
      },
      UpdateReplacePolicy: "Delete",
      DeletionPolicy: "Delete",
      Metadata: {
        "aws:cdk:path": "ShortsMvpCompute-production/BatchSubmitterLogs/Resource",
      },
    };
  }
  const metricFilter = METRIC_FILTER_CONTRACTS[logicalId];
  if (metricFilter) {
    return {
      Type: "AWS::Logs::MetricFilter",
      Properties: {
        FilterPattern: metricFilter.pattern,
        LogGroupName: { Ref: metricFilter.logGroup },
        MetricTransformations: [{
          DefaultValue: 0,
          MetricName: metricFilter.metric,
          MetricNamespace: "ShortsMvp/production",
          MetricValue: "1",
        }],
      },
      Metadata: {
        "aws:cdk:path": `ShortsMvpCompute-production/${metricFilter.path}/Resource`,
      },
    };
  }
  const alarm = ALARM_CONTRACTS[logicalId];
  if (alarm) {
    return {
      Type: "AWS::CloudWatch::Alarm",
      Properties: {
        AlarmName: alarm.alarmName,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        DatapointsToAlarm: 1,
        ...(alarm.dimensions ? { Dimensions: clone(alarm.dimensions) } : {}),
        EvaluationPeriods: 1,
        MetricName: alarm.metric,
        Namespace: alarm.namespace,
        Period: 60,
        Statistic: alarm.statistic,
        Tags: clone(CONTROL_PLANE_TAGS),
        Threshold: 1,
        TreatMissingData: "notBreaching",
      },
      Metadata: {
        "aws:cdk:path": `ShortsMvpCompute-production/${alarm.path}/Resource`,
      },
    };
  }
  throw new Error(`${logicalId} 추가 리소스의 고정 속성 계약이 없습니다.`);
}

function exactAllowedAddedResource(candidate, logicalId) {
  const expected = canonicalAddedControlPlaneResource(logicalId);
  if (fingerprint(expected) !== fingerprint(candidate)) {
    throw new Error(
      `${logicalId}에 고정된 로그/메트릭/알람 속성 계약 밖 변경이 있습니다.`,
    );
  }
  return expected;
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
  const rows = template?.Resources;
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) {
    throw new Error("CloudFormation template에 Resources 객체가 없습니다.");
  }
  return rows;
}

export function templateResourceChanges(currentTemplate, candidateTemplate) {
  const current = resources(currentTemplate);
  const candidate = resources(candidateTemplate);
  const logicalIds = new Set([...Object.keys(current), ...Object.keys(candidate)]);
  const changes = [];
  for (const logicalId of [...logicalIds].sort()) {
    const before = current[logicalId];
    const after = candidate[logicalId];
    if (fingerprint(before) === fingerprint(after)) continue;
    changes.push({
      logicalId,
      type: String(after?.Type || before?.Type || ""),
      action: before ? (after ? "update" : "delete") : "add",
      before,
      after,
    });
  }
  return changes;
}

function validateExpectedChange(change, expected) {
  if (!expected) {
    throw new Error(
      `허용 목록 밖 Control-plane 변경입니다: ${change.action} ${change.logicalId} (${change.type})`,
    );
  }
  if (change.action !== expected.action || change.type !== expected.type) {
    throw new Error(
      `Control-plane 변경 형태가 고정 allowlist와 다릅니다: ${change.logicalId}`,
    );
  }
}

function validatePackagingOnlyLambdaDrift(change) {
  if (change.action !== "update" || change.type !== "AWS::Lambda::Function") {
    throw new Error(`${change.logicalId} packaging drift 형태가 올바르지 않습니다.`);
  }
  const before = clone(change.before);
  const after = clone(change.after);
  if (
    typeof before?.Properties?.Code?.S3Key !== "string"
    || typeof after?.Properties?.Code?.S3Key !== "string"
  ) {
    throw new Error(`${change.logicalId} Lambda asset key가 없습니다.`);
  }
  after.Properties.Code.S3Key = before.Properties.Code.S3Key;
  for (const key of ["aws:asset:path", "aws:asset:is-bundled"]) {
    if (before.Metadata?.[key] === undefined) delete after.Metadata?.[key];
    else after.Metadata[key] = before.Metadata[key];
  }
  if (fingerprint(before) !== fingerprint(after)) {
    throw new Error(`${change.logicalId}에 asset packaging 밖 drift가 있습니다.`);
  }
}

function validateGeminiOnlyBatchDrift(change) {
  if (change.action !== "update" || change.type !== "AWS::Batch::JobDefinition") {
    throw new Error(`${change.logicalId} Batch drift 형태가 올바르지 않습니다.`);
  }
  const before = clone(change.before);
  const after = clone(change.after);
  const beforeEnvironment = before?.Properties?.ContainerProperties?.Environment;
  const afterEnvironment = after?.Properties?.ContainerProperties?.Environment;
  if (!Array.isArray(beforeEnvironment) || !Array.isArray(afterEnvironment)) {
    throw new Error(`${change.logicalId} Batch environment가 없습니다.`);
  }
  if (beforeEnvironment.some((row) => row?.Name === "GEMINI_TEXT_MODEL")) {
    throw new Error(`${change.logicalId} live template drift 전제가 달라졌습니다.`);
  }
  const added = afterEnvironment.filter((row) => row?.Name === "GEMINI_TEXT_MODEL");
  if (added.length !== 1 || added[0].Value !== "gemini-3.5-flash-lite") {
    throw new Error(`${change.logicalId}의 알려진 GEMINI_TEXT_MODEL drift가 다릅니다.`);
  }
  after.Properties.ContainerProperties.Environment = afterEnvironment.filter(
    (row) => row?.Name !== "GEMINI_TEXT_MODEL",
  );
  if (fingerprint(before) !== fingerprint(after)) {
    throw new Error(`${change.logicalId}에 알려진 환경값 밖 drift가 있습니다.`);
  }
}

function copyCandidateAssetIdentity(expected, candidate, logicalId) {
  const candidateMetadata = candidate?.Metadata;
  if (!candidateMetadata || typeof candidateMetadata !== "object") {
    throw new Error(`${logicalId} Lambda asset metadata가 없습니다.`);
  }
  expected.Metadata = clone(expected.Metadata || {});
  for (const key of ASSET_METADATA_KEYS) {
    if (candidateMetadata[key] === undefined) {
      delete expected.Metadata[key];
    } else {
      expected.Metadata[key] = clone(candidateMetadata[key]);
    }
  }
}

function exactAllowedLambdaUpdate(current, candidate, logicalId) {
  if (
    current?.Type !== "AWS::Lambda::Function"
    || candidate?.Type !== "AWS::Lambda::Function"
    || !current.Properties
    || !candidate.Properties
  ) {
    throw new Error(`${logicalId} Lambda 리소스가 올바르지 않습니다.`);
  }
  const expected = clone(current);
  const expectedCode = clone(current.Properties.Code || {});
  const candidateS3Key = candidate.Properties.Code?.S3Key;
  if (typeof candidateS3Key !== "string" || !candidateS3Key) {
    throw new Error(`${logicalId} Lambda candidate S3Key가 없습니다.`);
  }
  expectedCode.S3Key = candidateS3Key;
  if (fingerprint(expectedCode) !== fingerprint(candidate.Properties.Code)) {
    throw new Error(`${logicalId} Lambda Code에서 S3Key 밖 변경은 허용되지 않습니다.`);
  }
  expected.Properties.Code = expectedCode;
  copyCandidateAssetIdentity(expected, candidate, logicalId);

  if (logicalId === BATCH_SUBMITTER_FUNCTION) {
    const currentVariables = current.Properties.Environment?.Variables;
    if (!currentVariables || typeof currentVariables !== "object") {
      throw new Error("BatchSubmitter live 환경변수 계약이 없습니다.");
    }
    if (
      currentVariables.PROJECT_TARGET_REGISTRY_PATH !== undefined
      || currentVariables.PROJECT_TARGET_REGISTRY_REQUIRED !== undefined
    ) {
      throw new Error("BatchSubmitter live registry 전제가 이미 바뀌었습니다.");
    }
    expected.Properties.Environment = clone(current.Properties.Environment);
    expected.Properties.Environment.Variables = {
      ...clone(currentVariables),
      ...clone(BATCH_SUBMITTER_CANONICAL_TARGETS),
      ...clone(BATCH_SUBMITTER_CANONICAL_PROJECT_TARGETS),
      PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json",
      PROJECT_TARGET_REGISTRY_REQUIRED: "true",
    };
    expected.Properties.LoggingConfig = {
      LogGroup: { Ref: "BatchSubmitterLogsA1DC739B" },
    };
  } else if (![
    BATCH_STATE_FUNCTION,
    CLEANUP_FUNCTION,
    OUTBOX_DISPATCHER_FUNCTION,
  ].includes(logicalId)) {
    throw new Error(`${logicalId}는 속성 단위 Lambda 허용 목록에 없습니다.`);
  }

  if (fingerprint(expected) !== fingerprint(candidate)) {
    throw new Error(
      `${logicalId}에 Code/asset/고정 registry logging 계약 밖 변경이 있습니다.`,
    );
  }
  return expected;
}

export function validateControlPlaneTemplateDiff(currentTemplate, candidateTemplate) {
  const changes = templateResourceChanges(currentTemplate, candidateTemplate);
  const seen = new Set();
  for (const change of changes) {
    const expected = CONTROL_PLANE_RESOURCE_CHANGES[change.logicalId];
    validateExpectedChange(change, expected);
    if (expected.type === "AWS::Lambda::Function") {
      exactAllowedLambdaUpdate(
        change.before,
        change.after,
        change.logicalId,
      );
    } else if (expected.action === "add") {
      exactAllowedAddedResource(change.after, change.logicalId);
    }
    seen.add(change.logicalId);
  }
  const missing = Object.keys(CONTROL_PLANE_RESOURCE_CHANGES).filter(
    (logicalId) => !seen.has(logicalId),
  );
  if (missing.length) {
    throw new Error(`필수 Control-plane 변경이 후보에서 누락됐습니다: ${missing.join(", ")}`);
  }
  return changes.map(({ before: _before, after: _after, ...change }) => change);
}

export function buildExactControlPlaneTemplate(currentTemplate, fullCandidateTemplate) {
  const current = resources(currentTemplate);
  const candidate = resources(fullCandidateTemplate);
  const changes = templateResourceChanges(currentTemplate, fullCandidateTemplate);
  const controlPlaneSeen = new Set();
  const unexpected = [];
  for (const change of changes) {
    const expected = CONTROL_PLANE_RESOURCE_CHANGES[change.logicalId];
    if (expected) {
      validateExpectedChange(change, expected);
      if (expected.action === "add") {
        exactAllowedAddedResource(change.after, change.logicalId);
      }
      controlPlaneSeen.add(change.logicalId);
      continue;
    }
    if (PACKAGING_ONLY_LAMBDA_DRIFT.has(change.logicalId)) {
      validatePackagingOnlyLambdaDrift(change);
      continue;
    }
    if (PRESERVED_BATCH_DEFINITION_DRIFT.has(change.logicalId)) {
      validateGeminiOnlyBatchDrift(change);
      continue;
    }
    if (
      change.logicalId === "CDKMetadata"
      && change.action === "update"
      && change.type === "AWS::CDK::Metadata"
    ) {
      continue;
    }
    unexpected.push(change);
  }
  const missing = Object.keys(CONTROL_PLANE_RESOURCE_CHANGES).filter(
    (logicalId) => !controlPlaneSeen.has(logicalId),
  );
  if (missing.length || unexpected.length) {
    throw new Error([
      ...(missing.length ? [`필수 Control-plane 변경 누락: ${missing.join(", ")}`] : []),
      ...unexpected.map((change) => (
        `예상하지 않은 source/live drift: ${change.action} ${change.logicalId} (${change.type})`
      )),
    ].join("\n"));
  }

  const exact = clone(currentTemplate);
  const exactResources = resources(exact);
  for (const [logicalId, expected] of Object.entries(CONTROL_PLANE_RESOURCE_CHANGES)) {
    if (expected.action === "add" && current[logicalId]) {
      throw new Error(`${logicalId}는 live template에 없어야 합니다.`);
    }
    exactResources[logicalId] = expected.type === "AWS::Lambda::Function"
      ? exactAllowedLambdaUpdate(current[logicalId], candidate[logicalId], logicalId)
      : exactAllowedAddedResource(candidate[logicalId], logicalId);
  }

  for (const [logicalId, resource] of Object.entries(current)) {
    if (CONTROL_PLANE_RESOURCE_CHANGES[logicalId]) continue;
    if (fingerprint(resource) !== fingerprint(exactResources[logicalId])) {
      throw new Error(`보호 리소스가 byte-equivalent하지 않습니다: ${logicalId}`);
    }
  }
  validateControlPlaneTemplateDiff(currentTemplate, exact);
  return exact;
}

export function validatePreparedChangeSet(changeSet) {
  if (changeSet?.Status !== "CREATE_COMPLETE" || changeSet?.ExecutionStatus !== "AVAILABLE") {
    throw new Error("CloudFormation change set이 실행 가능한 preview 상태가 아닙니다.");
  }
  const seen = new Set();
  for (const row of changeSet.Changes || []) {
    const change = row?.ResourceChange || {};
    const logicalId = String(change.LogicalResourceId || "");
    const action = change.Action === "Add"
      ? "add"
      : change.Action === "Modify" ? "update" : "delete";
    const type = String(change.ResourceType || "");
    validateExpectedChange({ logicalId, action, type }, CONTROL_PLANE_RESOURCE_CHANGES[logicalId]);
    if (action === "delete") {
      throw new Error(`change set delete는 허용되지 않습니다: ${logicalId}`);
    }
    if (action === "update" && change.Replacement !== "False") {
      throw new Error(`리소스 교체 가능성이 있어 중단합니다: ${logicalId}`);
    }
    seen.add(logicalId);
  }
  const missing = Object.keys(CONTROL_PLANE_RESOURCE_CHANGES).filter(
    (logicalId) => !seen.has(logicalId),
  );
  if (missing.length) {
    throw new Error(`change set preview 변경 누락: ${missing.join(", ")}`);
  }
  return changeSet;
}

export function validateStackRollbackEnabled(stack) {
  if (!stack || stack.DisableRollback === true) {
    throw new Error("운영 stack rollback이 비활성화되어 있어 중단합니다.");
  }
  return stack;
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length !== 2) {
    throw new Error("usage: verify-control-plane-template-diff.mjs <current.json> <candidate.json>");
  }
  const current = JSON.parse(fs.readFileSync(path.resolve(argv[0]), "utf8"));
  const candidate = JSON.parse(fs.readFileSync(path.resolve(argv[1]), "utf8"));
  const changes = validateControlPlaneTemplateDiff(current, candidate);
  process.stdout.write([
    `Control-plane exact template 검사 통과: ${changes.length}개 변경`,
    ...changes.map(({ action, logicalId, type }) => `- ${action}: ${logicalId} (${type})`),
    "",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
