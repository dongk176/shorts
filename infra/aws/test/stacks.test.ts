import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ShortsMvpComputeStack, ShortsMvpFoundationStack } from "../lib/stacks";

function stacks() {
  const app = new cdk.App({ context: { vercelTeamSlug: "team", vercelProjectName: "shorts" } });
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

  it("uses public subnets without NAT and caps Batch at 12 vCPU", () => {
    const { compute } = stacks();
    compute.resourceCountIs("AWS::EC2::NatGateway", 0);
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({ MaxvCpus: 12, Type: "FARGATE" }),
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        RuntimePlatform: {
          CpuArchitecture: "X86_64",
          OperatingSystemFamily: "LINUX",
        },
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: "WARP_CONF_B64" }),
        ]),
      }),
    });
    compute.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
  });

  it("serializes BOT_CHECK recovery without automatic Batch retries", () => {
    const { compute } = stacks();
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        Environment: Match.arrayWith([
          { Name: "BOT_CHECK_COOLDOWN_SECONDS", Value: "1800" },
        ]),
      }),
      RetryStrategy: {
        Attempts: 2,
        EvaluateOnExit: [
          { Action: "EXIT", OnExitCode: "42" },
          { Action: "EXIT", OnExitCode: "43" },
          { Action: "RETRY", OnExitCode: "*" },
        ],
      },
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
