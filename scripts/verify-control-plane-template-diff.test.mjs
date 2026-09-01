import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_SUBMITTER_CANONICAL_PROJECT_TARGETS,
  BATCH_SUBMITTER_CANONICAL_TARGETS,
  buildExactControlPlaneTemplate,
  canonicalAddedControlPlaneResource,
  CONTROL_PLANE_RESOURCE_CHANGES,
  PRESERVED_BATCH_DEFINITION_DRIFT,
  validateControlPlaneTemplateDiff,
  validatePreparedChangeSet,
  validateStackRollbackEnabled,
} from "./verify-control-plane-template-diff.mjs";

const packagingOnlyLambdas = [
  "StateWriterFunctionB9BD747D",
];

function fixture() {
  const current = { Resources: {
    ProtectedQueue: {
      Type: "AWS::SQS::Queue",
      Properties: { QueueName: "do-not-touch" },
    },
  } };
  const candidate = structuredClone(current);
  for (const [logicalId, expected] of Object.entries(CONTROL_PLANE_RESOURCE_CHANGES)) {
    const isBatchSubmitter = logicalId === "BatchSubmitterFunction95B3701F";
    const resource = expected.type === "AWS::Lambda::Function"
      ? {
          Type: expected.type,
          Properties: {
            Code: { S3Bucket: "asset-bucket", S3Key: `${logicalId}-new.zip` },
            Environment: { Variables: { EXISTING: "same" } },
            Handler: "handler.handler",
            MemorySize: 512,
            Role: { "Fn::GetAtt": ["Role", "Arn"] },
            Runtime: "python3.12",
            Timeout: 60,
            ...(isBatchSubmitter ? {
              ReservedConcurrentExecutions: 10,
              LoggingConfig: { LogGroup: { Ref: "BatchSubmitterLogsA1DC739B" } },
            } : {
              LoggingConfig: { LogGroup: { Ref: "CleanupLogs0F08F816" } },
            }),
          },
          DependsOn: ["Role"],
          Metadata: {
            "aws:cdk:path": `Stack/${logicalId}/Resource`,
            "aws:asset:path": `asset.${logicalId}.new`,
            "aws:asset:is-bundled": true,
            "aws:asset:property": "Code",
          },
        }
      : canonicalAddedControlPlaneResource(logicalId);
    if (expected.action === "update") {
      current.Resources[logicalId] = {
        ...structuredClone(resource),
        Properties: {
          ...structuredClone(resource.Properties),
          Code: { S3Bucket: "asset-bucket", S3Key: `${logicalId}-old.zip` },
          ...(isBatchSubmitter ? { LoggingConfig: undefined } : {}),
        },
        Metadata: {
          ...resource.Metadata,
          "aws:asset:path": `asset.${logicalId}.old`,
        },
      };
      if (isBatchSubmitter) {
        delete current.Resources[logicalId].Properties.LoggingConfig;
        Object.assign(
          resource.Properties.Environment.Variables,
          structuredClone(BATCH_SUBMITTER_CANONICAL_TARGETS),
          structuredClone(BATCH_SUBMITTER_CANONICAL_PROJECT_TARGETS),
        );
        resource.Properties.Environment.Variables.PROJECT_TARGET_REGISTRY_PATH =
          "/var/task/production-project-targets.json";
        resource.Properties.Environment.Variables.PROJECT_TARGET_REGISTRY_REQUIRED = "true";
      }
    }
    candidate.Resources[logicalId] = resource;
  }
  for (const logicalId of packagingOnlyLambdas) {
    current.Resources[logicalId] = {
      Type: "AWS::Lambda::Function",
      Metadata: {
        "aws:asset:path": "asset.shared",
        "aws:asset:is-bundled": false,
      },
      Properties: {
        Handler: "handler.handler",
        Code: { S3Bucket: "asset-bucket", S3Key: "shared.zip" },
      },
    };
    candidate.Resources[logicalId] = {
      ...structuredClone(current.Resources[logicalId]),
      Metadata: {
        "aws:asset:path": `asset.${logicalId}`,
        "aws:asset:is-bundled": true,
      },
      Properties: {
        ...structuredClone(current.Resources[logicalId].Properties),
        Code: { S3Bucket: "asset-bucket", S3Key: `${logicalId}.zip` },
      },
    };
  }
  for (const logicalId of PRESERVED_BATCH_DEFINITION_DRIFT) {
    current.Resources[logicalId] = {
      Type: "AWS::Batch::JobDefinition",
      Properties: { ContainerProperties: { Environment: [
        { Name: "EXISTING", Value: "same" },
      ] } },
    };
    candidate.Resources[logicalId] = structuredClone(current.Resources[logicalId]);
    candidate.Resources[logicalId].Properties.ContainerProperties.Environment.unshift({
      Name: "GEMINI_TEXT_MODEL",
      Value: "gemini-3.5-flash-lite",
    });
  }
  for (const [logicalId, contract] of Object.entries({
    VercelControlPlaneRoleDefaultPolicyBC780244: {
      sid: "ReadWriteCustomBackgroundAssetsOnly",
      actions: ["s3:GetObject", "s3:PutObject"],
    },
    WorkerTaskRoleDefaultPolicy4DD5AEA2: {
      sid: "ReadCustomBackgroundAssetsOnly",
      actions: ["s3:GetObject"],
    },
  })) {
    current.Resources[logicalId] = {
      Type: "AWS::IAM::Policy",
      Properties: { PolicyDocument: { Statement: [
        { Sid: "Unchanged", Effect: "Allow", Action: "logs:CreateLogStream", Resource: "*" },
        {
          Sid: contract.sid,
          Effect: "Allow",
          Action: contract.actions,
          Resource: [
            "arn:aws:s3:::shortsmvpfoundation-production-mediabucketbcbb02ba-9rrhgi9ki9tn/custom-backgrounds/*",
          ],
        },
      ] } },
    };
    candidate.Resources[logicalId] = structuredClone(current.Resources[logicalId]);
    const statement = candidate.Resources[logicalId].Properties.PolicyDocument.Statement.pop();
    statement.Action = contract.actions.length === 1 ? contract.actions[0] : contract.actions;
    statement.Resource = {
      "Fn::Join": ["", [
        {
          "Fn::ImportValue":
            "ShortsMvpFoundation-production:ExportsOutputFnGetAttMediaBucketBCBB02BAArnB94B784B",
        },
        "/custom-backgrounds/*",
      ]],
    };
    candidate.Resources[logicalId].Properties.PolicyDocument.Statement.unshift(statement);
  }
  return { current, candidate };
}

test("builds an exact live-template patch and preserves every non-allowlisted resource", () => {
  const { current, candidate } = fixture();
  const exact = buildExactControlPlaneTemplate(current, candidate);
  assert.deepEqual(exact.Resources.ProtectedQueue, current.Resources.ProtectedQueue);
  for (const logicalId of packagingOnlyLambdas) {
    assert.deepEqual(exact.Resources[logicalId], current.Resources[logicalId]);
  }
  for (const logicalId of PRESERVED_BATCH_DEFINITION_DRIFT) {
    assert.deepEqual(exact.Resources[logicalId], current.Resources[logicalId]);
  }
  for (const logicalId of [
    "VercelControlPlaneRoleDefaultPolicyBC780244",
    "WorkerTaskRoleDefaultPolicy4DD5AEA2",
  ]) {
    assert.deepEqual(exact.Resources[logicalId], current.Resources[logicalId]);
  }
  assert.equal(
    validateControlPlaneTemplateDiff(current, exact).length,
    Object.keys(CONTROL_PLANE_RESOURCE_CHANGES).length,
  );
});

test("reconciles a registry rotation after the additive control plane is already installed", () => {
  const { current, candidate } = fixture();
  for (const [logicalId, expected] of Object.entries(CONTROL_PLANE_RESOURCE_CHANGES)) {
    if (expected.action === "add") {
      current.Resources[logicalId] = structuredClone(candidate.Resources[logicalId]);
    }
  }
  const submitter = current.Resources.BatchSubmitterFunction95B3701F;
  submitter.Properties.LoggingConfig = structuredClone(
    candidate.Resources.BatchSubmitterFunction95B3701F.Properties.LoggingConfig,
  );
  submitter.Properties.Environment = structuredClone(
    candidate.Resources.BatchSubmitterFunction95B3701F.Properties.Environment,
  );
  submitter.Properties.Environment.Variables
    .UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN = "arn:aws:batch:region:account:job-definition/old:1";

  const exact = buildExactControlPlaneTemplate(current, candidate);
  assert.equal(validateControlPlaneTemplateDiff(current, exact).length, 4);
  for (const [logicalId, expected] of Object.entries(CONTROL_PLANE_RESOURCE_CHANGES)) {
    if (expected.action === "add") {
      assert.deepEqual(exact.Resources[logicalId], current.Resources[logicalId]);
    }
  }

  const drifted = structuredClone(candidate);
  drifted.Resources.BatchSubmitterFailureAlarm9EBC0935.Properties.Threshold = 2;
  assert.throws(
    () => buildExactControlPlaneTemplate(current, drifted),
    /속성 계약 밖 변경/,
  );
});

test("rejects deletes, arbitrary Lambda/IAM changes, and unrecognised Batch drift", () => {
  const { current, candidate } = fixture();
  const exact = buildExactControlPlaneTemplate(current, candidate);
  const deleted = structuredClone(exact);
  delete deleted.Resources.ProtectedQueue;
  assert.throws(
    () => validateControlPlaneTemplateDiff(current, deleted),
    /허용 목록 밖/,
  );

  const arbitraryLambda = structuredClone(candidate);
  arbitraryLambda.Resources.UnexpectedFunction = {
    Type: "AWS::Lambda::Function",
    Properties: {},
  };
  assert.throws(
    () => buildExactControlPlaneTemplate(current, arbitraryLambda),
    /예상하지 않은 source\/live drift/,
  );

  const arbitraryIam = structuredClone(candidate);
  arbitraryIam.Resources.UnexpectedPolicy = {
    Type: "AWS::IAM::Policy",
    Properties: {},
  };
  assert.throws(
    () => buildExactControlPlaneTemplate(current, arbitraryIam),
    /UnexpectedPolicy/,
  );

  const customBackgroundIamExpansion = structuredClone(candidate);
  customBackgroundIamExpansion.Resources
    .VercelControlPlaneRoleDefaultPolicyBC780244
    .Properties.PolicyDocument.Statement
    .find((statement) => statement.Sid === "ReadWriteCustomBackgroundAssetsOnly")
    .Action.push("s3:DeleteObject");
  assert.throws(
    () => buildExactControlPlaneTemplate(current, customBackgroundIamExpansion),
    /권한 계약.*밖으로 변경/,
  );

  for (const [property, value] of [
    ["Role", { "Fn::GetAtt": ["DifferentRole", "Arn"] }],
    ["Runtime", "python3.13"],
    ["Timeout", 900],
    ["MemorySize", 10240],
    ["ReservedConcurrentExecutions", 999],
  ]) {
    const lambdaDrift = structuredClone(candidate);
    lambdaDrift.Resources.BatchSubmitterFunction95B3701F.Properties[property] = value;
    assert.throws(
      () => buildExactControlPlaneTemplate(current, lambdaDrift),
      /계약 밖 변경/,
    );
  }

  const cleanupVpcDrift = structuredClone(candidate);
  cleanupVpcDrift.Resources.CleanupFunction1604930F.Properties.VpcConfig = {
    SecurityGroupIds: ["sg-unsafe"],
    SubnetIds: ["subnet-unsafe"],
  };
  assert.throws(
    () => buildExactControlPlaneTemplate(current, cleanupVpcDrift),
    /계약 밖 변경/,
  );

  const codeBucketDrift = structuredClone(candidate);
  codeBucketDrift.Resources.BatchSubmitterFunction95B3701F.Properties.Code.S3Bucket =
    "untrusted-bucket";
  assert.throws(
    () => buildExactControlPlaneTemplate(current, codeBucketDrift),
    /S3Key 밖 변경/,
  );

  const targetTokenDrift = structuredClone(candidate);
  targetTokenDrift.Resources.BatchSubmitterFunction95B3701F.Properties
    .Environment.Variables.PREPARE_JOB_DEFINITION = {
      "Fn::GetAtt": ["RenderJobDefinition", "JobDefinitionArn"],
    };
  assert.throws(
    () => buildExactControlPlaneTemplate(current, targetTokenDrift),
    /계약 밖 변경/,
  );

  const projectTargetDrift = structuredClone(candidate);
  projectTargetDrift.Resources.BatchSubmitterFunction95B3701F.Properties
    .Environment.Variables.LEGACY_PROJECT_JOB_DEFINITION_ARN =
      projectTargetDrift.Resources.BatchSubmitterFunction95B3701F.Properties
        .Environment.Variables.SOURCE_RANGE_JOB_DEFINITION_ARN;
  assert.throws(
    () => buildExactControlPlaneTemplate(current, projectTargetDrift),
    /계약 밖 변경/,
  );

  const outboxRoleDrift = structuredClone(candidate);
  outboxRoleDrift.Resources.OutboxDispatcherFunction7D53F71C.Properties.Role =
    { "Fn::GetAtt": ["DifferentRole", "Arn"] };
  assert.throws(
    () => buildExactControlPlaneTemplate(current, outboxRoleDrift),
    /계약 밖 변경/,
  );

  for (const mutate of [
    (resource) => {
      resource.Properties.Role = { "Fn::GetAtt": ["DifferentRole", "Arn"] };
    },
    (resource) => {
      resource.Properties.Environment.Variables.UNSAFE = "true";
    },
  ]) {
    const batchStateDrift = structuredClone(candidate);
    mutate(batchStateDrift.Resources.BatchStateFunction2DEF92D9);
    assert.throws(
      () => buildExactControlPlaneTemplate(current, batchStateDrift),
      /계약 밖 변경/,
    );
  }

  const batchDrift = structuredClone(candidate);
  batchDrift.Resources.LongJobDefinition.Properties.Timeout = 123;
  assert.throws(
    () => buildExactControlPlaneTemplate(current, batchDrift),
    /알려진 환경값 밖 drift/,
  );
});

test("rejects every security-relevant drift in added log, metric, and alarm resources", () => {
  const mutations = [
    ["BatchSubmitterLogsA1DC739B", (resource) => {
      resource.Properties.RetentionInDays = 1;
    }],
    ["BatchSubmitterFailureMetric3C910ADE", (resource) => {
      resource.Properties.FilterPattern = "";
    }],
    ["BatchTargetTrustRejectedMetricAA20989D", (resource) => {
      resource.Properties.MetricTransformations[0].MetricNamespace = "Other";
    }],
    ["QueuedWithoutBatchIdMetric9DFC10D7", (resource) => {
      resource.Properties.LogGroupName = { Ref: "OtherLogs" };
    }],
    ["BatchSubmitterFailureAlarm9EBC0935", (resource) => {
      resource.Properties.AlarmActions = ["arn:aws:sns:ap-northeast-2:123456789012:unsafe"];
    }],
    ["BatchTargetUnknownReleaseAlarm761180F2", (resource) => {
      resource.Properties.TreatMissingData = "breaching";
    }],
    ["ProjectDispatchHealthCheckFailedAlarmF411030C", (resource) => {
      resource.Properties.Threshold = 100;
    }],
    ["BatchSubmitterLambdaErrorAlarm829AEAB9", (resource) => {
      resource.Properties.Dimensions[0].Value = { Ref: "OtherFunction" };
    }],
    ["WorkDispatchDlqAlarm119DCF63", (resource) => {
      resource.Properties.Statistic = "Average";
    }],
  ];
  for (const [logicalId, mutate] of mutations) {
    const { current, candidate } = fixture();
    mutate(candidate.Resources[logicalId]);
    assert.throws(
      () => buildExactControlPlaneTemplate(current, candidate),
      /속성 계약 밖 변경/,
      logicalId,
    );
  }
});

test("execute-time validation rejects an allowlisted Lambda with altered role or environment", () => {
  const { current, candidate } = fixture();
  const exact = buildExactControlPlaneTemplate(current, candidate);
  for (const mutate of [
    (resource) => {
      resource.Properties.Role = { "Fn::GetAtt": ["DifferentRole", "Arn"] };
    },
    (resource) => {
      resource.Properties.Environment.Variables.UNSAFE = "true";
    },
  ]) {
    const malicious = structuredClone(exact);
    mutate(malicious.Resources.BatchSubmitterFunction95B3701F);
    assert.throws(
      () => validateControlPlaneTemplateDiff(current, malicious),
      /계약 밖 변경/,
    );
  }
});

test("requires a complete non-replacing change-set preview and rollback-enabled stack", () => {
  const changes = Object.entries(CONTROL_PLANE_RESOURCE_CHANGES).map(
    ([logicalId, expected]) => ({ ResourceChange: {
      Action: expected.action === "add" ? "Add" : "Modify",
      LogicalResourceId: logicalId,
      ResourceType: expected.type,
      Replacement: "False",
    } }),
  );
  const preview = {
    Status: "CREATE_COMPLETE",
    ExecutionStatus: "AVAILABLE",
    Changes: changes,
  };
  assert.doesNotThrow(() => validatePreparedChangeSet(preview));
  const updateOnlyPreview = {
    ...preview,
    Changes: changes.filter(({ ResourceChange }) => (
      CONTROL_PLANE_RESOURCE_CHANGES[ResourceChange.LogicalResourceId].action === "update"
    )),
  };
  assert.doesNotThrow(() => validatePreparedChangeSet(updateOnlyPreview));
  assert.throws(
    () => validatePreparedChangeSet({
      ...preview,
      Changes: changes.map((row, index) => index === 0
        ? { ResourceChange: { ...row.ResourceChange, Replacement: "Conditional" } }
        : row),
    }),
    /교체 가능성/,
  );
  assert.throws(
    () => validatePreparedChangeSet({ ...preview, Changes: changes.slice(1) }),
    /변경 누락/,
  );
  assert.doesNotThrow(() => validateStackRollbackEnabled({ DisableRollback: false }));
  assert.throws(() => validateStackRollbackEnabled({ DisableRollback: true }), /rollback/);
});
