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
  it("keeps S3 private with 30-day lifecycle and CloudFront OAC", () => {
    const { foundation } = stacks();
    foundation.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 30, Status: "Enabled" })]),
      },
    });
    foundation.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/outputs/"),
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
          Match.objectLike({ Name: "WARP_CONF_B64" }),
          Match.objectLike({ Name: "WARP_CONF_A_B64" }),
          Match.objectLike({ Name: "WARP_CONF_B_B64" }),
          Match.objectLike({ Name: "WARP_CONF_C_B64" }),
          Match.objectLike({ Name: "WARP_CONF_D_B64" }),
        ]),
      }),
    });
    expect(JSON.stringify(compute.toJSON())).toContain("test-worker-image");
    expect(JSON.stringify(compute.toJSON())).not.toContain(":latest");
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        Environment: Match.arrayWith([
          { Name: "AWS_REGION", Value: "ap-northeast-2" },
          { Name: "AWS_DEFAULT_REGION", Value: "ap-northeast-2" },
          { Name: "OPENAI_TRANSCRIBE_MODEL", Value: "gpt-4o-mini-transcribe" },
          { Name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", Value: "gpt-5-nano" },
          { Name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", Value: "30" },
          { Name: "OPENAI_TRANSCRIBE_MAX_WORKERS", Value: "4" },
          { Name: "WARP_BOT_CHECK_COOLDOWN_SECONDS", Value: "15" },
        ]),
      }),
    });
    compute.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
    compute.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupEgress: Match.arrayWith([Match.objectLike({
        IpProtocol: "udp",
        FromPort: 2408,
        ToPort: 2408,
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
    compute.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
    });
  });

  it("does not create wildcard IAM actions", () => {
    const { compute } = stacks();
    const policies = compute.findResources("AWS::IAM::Policy");
    for (const policy of Object.values(policies) as Array<Record<string, unknown>>) {
      expect(JSON.stringify(policy)).not.toContain('"Action":"*"');
    }
  });
});
