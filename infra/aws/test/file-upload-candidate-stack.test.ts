import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { UploadCandidateStack, type UploadCandidateProps } from "../lib/file-upload-candidate-stack";
const props: UploadCandidateProps = {
  env: { account: "181651591905", region: "ap-northeast-2" },
  releaseId: "d201e5fe-5b29-4ad8-8817-9d584ac902dd", administratorId: "e86821c9-2eb2-4c04-b748-fd269fc46f20",
  expiresAt: "2026-11-06T12:00:00Z", sourceSha: "a".repeat(40), fontManifest: "b".repeat(64),
  image: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:${"c".repeat(64)}`,
  previewOrigin: "https://shorts-test-artiroom.vercel.app",
  clusterArn: "arn:aws:ecs:ap-northeast-2:181651591905:cluster/shorts-mvp-file-upload-production",
  listenerArn: "arn:aws:elasticloadbalancing:ap-northeast-2:181651591905:listener/app/test/1/2",
  listenerPriority: 41, loadBalancerDns: "internal-existing.ap-northeast-2.elb.amazonaws.com",
  vpcId: "vpc-12345678", subnets: ["subnet-12345678", "subnet-87654321"], securityGroups: ["sg-12345678"],
  executionRoleArn: "arn:aws:iam::181651591905:role/existing-upload-execution",
  controlPlaneRoleArn: "arn:aws:iam::181651591905:role/existing-web", mediaBucket: "existing-media",
  taskTemplate: { cpu: "4096", memory: "8192", ephemeralStorage: { sizeInGiB: 80 },
    containerDefinitions: [{ name: "file-upload-receiver", image: "unused:fixture", essential: true, environment: [
      { name: "MIDFORM_ENABLED", value: "true" }, { name: "FILE_UPLOAD_CAPACITY_FUNCTION_ARN", value: "old-public-capacity" },
    ], portMappings: [{ containerPort: 8080 }] }, { name: "file-upload-scratch-initializer", image: "unused:fixture", essential: false }] },
};
it("adds only an isolated zero-idle-capacity receiver and never a new ALB/VPC or public service", () => {
  const stack = new UploadCandidateStack(new cdk.App(), "IsolatedTest", props);
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  template.resourceCountIs("AWS::EC2::VPC", 0);
  template.resourceCountIs("AWS::KMS::Key", 0);
  template.resourceCountIs("AWS::ECS::Service", 1);
  template.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 0, ServiceName: "shorts-upload-candidate-d201e5fe" });
  template.hasResourceProperties("AWS::Lambda::Function", { Environment: { Variables: {
    MAX_CAPACITY: "1", WARM_SECONDS: "0", ECS_SERVICE: "shorts-upload-candidate-d201e5fe",
  } } });
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
    Priority: 41, Conditions: [{ Field: "path-pattern", Values: [`/admin-upload/${props.releaseId}/*`] },
      { Field: "http-header", HttpHeaderConfig: { HttpHeaderName: "x-easycut-origin-verify", Values: [{ Ref: "OriginSecret" }] } }],
  });
  const json = template.toJSON();
  expect(json.Parameters.OriginSecret.NoEcho).toBe(true);
  const serialized = JSON.stringify(json);
  expect(serialized).not.toContain("old-public-capacity");
  expect(serialized).not.toContain('"Name":"MIDFORM_ENABLED","Value":"true"');
  for (const resource of Object.values(json.Resources) as {Type:string;Properties?:{PolicyDocument?:{Statement?:{Action:string[]|string,Resource:unknown}[]}}}[]) {
    if (resource.Type !== "AWS::IAM::Policy") continue;
    for (const statement of resource.Properties?.PolicyDocument?.Statement ?? []) {
      if (JSON.stringify(statement.Action).includes("ecs:UpdateService")) {
        expect(JSON.stringify(statement.Resource)).toContain("shorts-upload-candidate-d201e5fe");
        expect(JSON.stringify(statement.Resource)).not.toContain("/shorts-mvp-file-upload-production\"");
      }
    }
  }
});
it("rejects wrong accounts, mutable images and overlapping routing priorities", () => {
  for (const change of [{env:{account:"426197262986",region:"ap-northeast-2"}}, {image:"repo:latest"}, {listenerPriority:1}]) {
    expect(() => new UploadCandidateStack(new cdk.App(), "Invalid", {...props,...change})).toThrow();
  }
});
