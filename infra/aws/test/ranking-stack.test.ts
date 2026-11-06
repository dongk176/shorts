import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { RankingAdminStack, type RankingProps } from "../lib/ranking-stack";
const props: RankingProps = {
  proxyDestinations: [{ address: "203.0.113.8", port: 6214 }],
  env: { account: "181651591905", region: "ap-northeast-2" },
  vpcId: "vpc-12345678",
  vpcCidr: "10.0.0.0/16",
  subnets: ["subnet-12345678"],
  availabilityZones: ["ap-northeast-2a"],
  albSecurityGroupId: "sg-12345678",
  listenerArn:
    "arn:aws:elasticloadbalancing:ap-northeast-2:181651591905:listener/app/test/123/456",
  listenerPriority: 40,
  vpcOriginId: "vo_RankingTest123",
  albDnsName: "internal-existing-123.ap-northeast-2.elb.amazonaws.com",
  image: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/ranking@sha256:${"a".repeat(64)}`,
  sourceCommit: "b".repeat(40),
  runtimeSecretArn:
    "arn:aws:secretsmanager:ap-northeast-2:181651591905:secret:ranking-ABCDEF",
  outputBucket: "existing-media",
  vercelRoleArn: "arn:aws:iam::181651591905:role/existing-web",
  allowedOrigins: ["https://www.easycut.co.kr"],
};
function template(overrides: Partial<RankingProps> = {}) {
  return Template.fromStack(
    new RankingAdminStack(new cdk.App(), "TestRanking", {
      ...props,
      ...overrides,
    }),
  );
}
describe("isolated ranking infrastructure", () => {
  it("creates no new load balancer, NAT, database, or ordinary upload service", () => {
    const t = template();
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    t.resourceCountIs("AWS::EC2::NatGateway", 0);
    t.resourceCountIs("AWS::RDS::DBInstance", 0);
    t.resourceCountIs("AWS::ECS::Service", 1);
    t.hasResourceProperties("AWS::ECS::Service", {
      ServiceName: "shorts-ranking-production",
      DesiredCount: 0,
      DeploymentConfiguration: {
        MaximumPercent: 100,
        MinimumHealthyPercent: 0,
        DeploymentCircuitBreaker: Match.anyValue(),
      },
    });
  });
  it("only adds a ranking-path listener rule and keeps outputs confined", () => {
    const t = template();
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Conditions: [
        { Field: "path-pattern", Values: ["/ranking/*"] },
        {
          Field: "http-header",
          HttpHeaderConfig: {
            HttpHeaderName: "x-easycut-origin-verify",
            Values: Match.anyValue(),
          },
        },
      ],
    });
    const serialized = JSON.stringify(t.toJSON());
    expect(serialized).toContain("outputs/ranking/*");
    expect(serialized).not.toContain('"Action":"s3:*"');
    expect(serialized).not.toContain("EasyCutYoutubeTest");
    t.resourceCountIs("AWS::CloudFront::Distribution", 1);
    t.resourceCountIs("AWS::CloudFront::VpcOrigin", 0);
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 0);
    expect(serialized).toContain("RANKING_ORIGIN_SECRET");
    expect(serialized).toContain("RANKING_WEBSHARE_ENABLED");
    expect(serialized).toContain("INGESTION_PROXY_ROUTES_JSON");
    expect(serialized).toContain("PROXY_REGISTRY_SECRET_ARN");
    expect(serialized).toContain("ReadCurrentProxyRegistryOnly");
    expect(serialized).not.toContain("WARP_CONF");
  });
  it("rejects unpinned images and cross-account dependencies", () => {
    expect(() => template({ proxyDestinations: [] })).toThrow();
    expect(() => template({ proxyDestinations: [{ address: "127.0.0.1", port: 80 }] })).toThrow();
    expect(() => template({ image: "image:latest" })).toThrow();
    expect(() =>
      template({
        runtimeSecretArn: props.runtimeSecretArn.replace(
          "181651591905",
          "426197262986",
        ),
      }),
    ).toThrow();
    expect(() =>
      template({ env: { account: "426197262986", region: "ap-northeast-2" } }),
    ).toThrow();
  });
});
