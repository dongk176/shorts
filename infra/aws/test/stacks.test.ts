import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ShortsMvpComputeStack, ShortsMvpFoundationStack } from "../lib/stacks";

function stacks() {
  const app = new cdk.App({ context: {
    vercelTeamSlug: "team",
    vercelProjectName: "shorts",
    workerImageTag: "test-worker-image",
  } });
  const env = { account: "123456789012", region: "ap-northeast-2" };
  const foundation = new ShortsMvpFoundationStack(app, "Foundation", {
    env,
    environment: "test",
  });
  const compute = new ShortsMvpComputeStack(app, "Compute", {
    env,
    environment: "test",
    foundation,
  });
  return { foundation: Template.fromStack(foundation), compute: Template.fromStack(compute) };
}

describe("shorts MVP infrastructure", () => {
  it("keeps S3 private, expires regular media, and retains example media", () => {
    const { foundation } = stacks();
    foundation.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: "outputs/", ExpirationInDays: 30, Status: "Enabled" }),
          Match.objectLike({ Prefix: "thumbnails/", ExpirationInDays: 30, Status: "Enabled" }),
          Match.objectLike({ Prefix: "edit-sources/", ExpirationInDays: 30, Status: "Enabled" }),
        ]),
      },
    });
    foundation.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/outputs/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/examples/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/edit-sources/"),
    });
  });

  it("uses scalable Prepare Fargate and zero-idle Render Spot with fallback", () => {
    const { compute } = stacks();
    compute.resourceCountIs("AWS::EC2::NatGateway", 0);
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({ MaxvCpus: 4000, Type: "FARGATE" }),
    });
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({
        MaxvCpus: 4000, MinvCpus: 0, Type: "SPOT",
        AllocationStrategy: "SPOT_PRICE_CAPACITY_OPTIMIZED",
      }),
    });
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({ MaxvCpus: 4000, MinvCpus: 0, Type: "EC2" }),
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        RuntimePlatform: {
          CpuArchitecture: "X86_64",
          OperatingSystemFamily: "LINUX",
        },
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: "INGESTION_PROXY_ROUTES_JSON" }),
        ]),
      }),
    });
    const jobDefinitions = Object.values(
      compute.findResources("AWS::Batch::JobDefinition")
    ) as Array<Record<string, unknown>>;
    const jobDefinition = (name: string) => jobDefinitions.find((definition) => (
      (definition.Properties as Record<string, unknown>)?.JobDefinitionName === name
    ));
    const prepareJobDefinition = jobDefinition("shorts-mvp-prepare-test");
    const renderJobDefinition = jobDefinition("shorts-mvp-render-test");

    expect(prepareJobDefinition).toBeDefined();
    expect(renderJobDefinition).toBeDefined();
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_EGRESS_MODE");
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_BOT_CHECK_COOLDOWN_SECONDS");
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_PROXY_ROUTES_JSON");
    expect(JSON.stringify(renderJobDefinition)).not.toContain("INGESTION_");
    expect(
      jobDefinitions.filter((definition) => (
        JSON.stringify(definition).includes("INGESTION_PROXY_ROUTES_JSON")
      ))
    ).toHaveLength(1);
    expect(
      jobDefinitions.filter((definition) => (
        JSON.stringify(definition).includes("INGESTION_EGRESS_MODE")
      ))
    ).toHaveLength(1);
    expect(JSON.stringify(jobDefinitions)).not.toContain("WARP_CONF_B64");
    expect(JSON.stringify(compute.toJSON())).toContain("test-worker-image");
    expect(JSON.stringify(prepareJobDefinition)).toContain("test-worker-image-prepare");
    expect(JSON.stringify(renderJobDefinition)).toContain("test-worker-image");
    expect(JSON.stringify(renderJobDefinition)).not.toContain("test-worker-image-prepare");
    expect(JSON.stringify(compute.toJSON())).not.toContain(":latest");
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        Environment: Match.arrayWith([
          { Name: "AWS_REGION", Value: "ap-northeast-2" },
          { Name: "AWS_DEFAULT_REGION", Value: "ap-northeast-2" },
          { Name: "OPENAI_TRANSCRIBE_MODEL", Value: "gpt-4o-mini-transcribe" },
          { Name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", Value: "gpt-5-nano" },
          { Name: "OPENAI_COMMENT_FALLBACK_MODEL", Value: "gpt-5-nano" },
          { Name: "GEMINI_COMMENT_MODEL", Value: "gemini-2.5-flash-lite" },
          { Name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", Value: "30" },
          { Name: "OPENAI_TRANSCRIBE_MAX_WORKERS", Value: "4" },
          { Name: "INGESTION_EGRESS_MODE", Value: "webshare_isp" },
          { Name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", Value: "30" },
        ]),
      }),
    });
    compute.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
    compute.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupEgress: Match.arrayWith([Match.objectLike({
        IpProtocol: "tcp",
        FromPort: 1000,
        ToPort: 9999,
      })]),
    });
  });

  it("uses bounded Prepare and Render attempts with a one-minute SQS retry", () => {
    const { compute } = stacks();
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      RetryStrategy: {
        Attempts: 1,
      },
      Timeout: { AttemptDurationSeconds: 3600 },
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-render-test",
      Timeout: { AttemptDurationSeconds: 1200 },
    });
    compute.resourceCountIs("AWS::SQS::Queue", 3);
    compute.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 180,
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 10,
      Timeout: 30,
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "outbox_dispatcher.handler",
      Environment: {
        Variables: Match.objectLike({
          BATCH_SUBMITTER_FUNCTION_NAME: Match.anyValue(),
        }),
      },
    });
    compute.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
    });
  });

  it("does not create wildcard IAM actions", () => {
    const { compute } = stacks();
    const policies = compute.findResources("AWS::IAM::Policy");
    const serializedPolicies = JSON.stringify(policies);
    expect(serializedPolicies).toContain("lambda:InvokeFunction");
    expect(serializedPolicies).toContain("OutboxDispatcherFunction");
    expect(serializedPolicies).toContain("function:shorts-mvp-batch-submitter-test");
    expect(serializedPolicies).not.toContain("function/shorts-mvp-batch-submitter-test");
    for (const policy of Object.values(policies) as Array<Record<string, unknown>>) {
      expect(JSON.stringify(policy)).not.toContain('"Action":"*"');
    }
  });
});
