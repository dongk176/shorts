import { readFileSync } from "node:fs";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  fileUploadCanaryIncluded,
  ShortsMvpFileUploadCanaryStack,
} from "../lib/file-upload-stack";

const digest = `sha256:${"a".repeat(64)}`;
const sourceSha = "b".repeat(40);
const fontManifestSha256 = "c".repeat(64);
const originSecret = `origin-secret-${"x".repeat(48)}`;

function stackTemplate(overrides: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: {
    repositoryUri:
      "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-worker-production",
    imageDigest: digest,
    workerSourceGitSha: sourceSha,
    fontManifestSha256,
    runtimeSecretArn:
      "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:shorts-mvp/production/worker-runtime-AbCdEf",
    vercelControlPlaneRoleArn:
      "arn:aws:iam::123456789012:role/shorts-mvp-production-vercel-control-plane",
    mediaBucketName: "shorts-mvp-production-media",
    cloudfrontPrefixListId: "pl-1234abcd",
    originVerifyHeader: originSecret,
    ...overrides,
  } });
  const stack = new ShortsMvpFileUploadCanaryStack(app, "FileUpload", {
    env: { account: "123456789012", region: "ap-northeast-2" },
    environment: "production",
  });
  return Template.fromStack(stack);
}

describe("file upload canary opt-in", () => {
  it("is absent by default and instantiated only behind includeFileUpload", () => {
    expect(fileUploadCanaryIncluded(undefined)).toBe(false);
    expect(fileUploadCanaryIncluded(false)).toBe(false);
    expect(fileUploadCanaryIncluded("false")).toBe(false);
    expect(fileUploadCanaryIncluded("true")).toBe(true);

    const bin = readFileSync(path.resolve(__dirname, "../bin/shorts-mvp.ts"), "utf8");
    expect(bin).toContain(
      'fileUploadCanaryIncluded(app.node.tryGetContext("includeFileUpload"))',
    );
    expect(bin.indexOf("if (fileUploadCanaryIncluded")).toBeLessThan(
      bin.indexOf("new ShortsMvpFileUploadCanaryStack"),
    );
  });

  it("fails synthesis without immutable and secret context", () => {
    for (const name of [
      "repositoryUri",
      "imageDigest",
      "workerSourceGitSha",
      "fontManifestSha256",
      "runtimeSecretArn",
      "vercelControlPlaneRoleArn",
      "mediaBucketName",
      "cloudfrontPrefixListId",
      "originVerifyHeader",
    ]) {
      expect(() => stackTemplate({ [name]: "" })).toThrow(
        `${name} context is required`,
      );
    }
    expect(() => stackTemplate({ imageDigest: "latest" })).toThrow(
      "imageDigest must be an immutable sha256 digest",
    );
    expect(() => stackTemplate({ originVerifyHeader: "too-short" })).toThrow(
      "originVerifyHeader must be a non-whitespace secret",
    );
  });
});

describe("isolated file upload canary stack", () => {
  it("pins an encrypted 4-vCPU receiver while keeping a new canary cold", () => {
    const template = stackTemplate();

    template.hasResourceProperties("AWS::ECS::Cluster", {
      ClusterName: "shorts-mvp-file-upload-production",
      Configuration: {
        ManagedStorageConfiguration: {
          FargateEphemeralStorageKmsKeyId: Match.anyValue(),
        },
      },
    });
    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
    });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "4096",
      Memory: "8192",
      EphemeralStorage: { SizeInGiB: 80 },
      ContainerDefinitions: Match.arrayWith([Match.objectLike({
        Name: "file-upload-scratch-initializer",
        EntryPoint: ["/usr/local/bin/python", "-c"],
        Command: [Match.stringLikeRegexp("os\\.chown\\('/scratch', 10001, 10001\\)")],
        Essential: false,
        ReadonlyRootFilesystem: true,
        User: "0:0",
        MountPoints: [{
          ContainerPath: "/scratch",
          ReadOnly: false,
          SourceVolume: "UploadScratch",
        }],
      }), Match.objectLike({
        Name: "file-upload-receiver",
        EntryPoint: ["/usr/local/bin/python", "-m", "shorts_worker.upload_service"],
        Command: [],
        ReadonlyRootFilesystem: true,
        User: "10001:10001",
        MountPoints: [{
          ContainerPath: "/scratch",
          ReadOnly: false,
          SourceVolume: "UploadScratch",
        }],
        PortMappings: Match.arrayWith([Match.objectLike({ ContainerPort: 8080 })]),
        HealthCheck: Match.objectLike({
          Command: Match.arrayWith([Match.stringLikeRegexp("/livez")]),
        }),
        DependsOn: [{
          Condition: "SUCCESS",
          ContainerName: "file-upload-scratch-initializer",
        }],
      })]),
    });
    const renderedTask = JSON.stringify(Object.values(
      template.findResources("AWS::ECS::TaskDefinition"),
    )[0]);
    expect(renderedTask).toContain(`@${digest}`);
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 0,
      HealthCheckGracePeriodSeconds: 21_600,
      LaunchType: "FARGATE",
      ServiceName: "shorts-mvp-file-upload-production",
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "ENABLED" }),
      },
    });
    template.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 1);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  it("starts one receiver only after an explicit canary opt-in", () => {
    const template = stackTemplate({ fileUploadDesiredCount: "1" });
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      LaunchType: "FARGATE",
    });
    template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
      MinCapacity: 0,
      MaxCapacity: 20,
    });
    expect(() => stackTemplate({ fileUploadDesiredCount: "21" })).toThrow(
      "fileUploadDesiredCount must be between 0 and 20",
    );
  });

  it("limits task permissions to derived media and excludes ingestion credentials", () => {
    const template = stackTemplate();
    const rendered = JSON.stringify(template.toJSON());
    const taskDefinitions = template.findResources("AWS::ECS::TaskDefinition");
    const taskDefinition = JSON.stringify(Object.values(taskDefinitions)[0]);

    for (const prefix of ["outputs/", "thumbnails/", "edit-sources/"]) {
      expect(rendered).toContain(prefix);
    }
    expect(rendered).not.toContain("raw-sources/");
    expect(rendered).not.toContain("source-videos/");
    expect(rendered).not.toContain("originals/");
    expect(taskDefinition).not.toContain("INGESTION_PROXY_ROUTES_JSON");
    expect(taskDefinition).not.toContain("INGESTION_EGRESS_MODE");
    expect(taskDefinition).not.toContain("WARP_CONF");
    expect(taskDefinition).not.toContain("YOUTUBE_API_KEY");
    expect(taskDefinition).not.toContain("SUPABASE_URL");
    expect(taskDefinition).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(taskDefinition).toContain("DATABASE_URL");
    expect(taskDefinition).not.toContain("FILE_UPLOAD_TOKEN_SECRET");
    expect(taskDefinition).toContain("ELEVENLABS_API_KEY");
    const taskDefinitionResource = Object.values(taskDefinitions)[0];
    const initializer = taskDefinitionResource.Properties?.ContainerDefinitions
      ?.find((item: { Name?: string }) => item.Name === "file-upload-scratch-initializer");
    expect(initializer).toBeTruthy();
    expect(initializer).not.toHaveProperty("Secrets");
    expect(initializer).not.toHaveProperty("Environment");
    expect(initializer).not.toHaveProperty("PortMappings");
    for (const [name, value] of Object.entries({
      ELEVENLABS_TRANSCRIBE_MODEL: "scribe_v2",
      OPENAI_TRANSCRIBE_MODEL: "gpt-4o-mini-transcribe",
      OPENAI_TRANSCRIBE_FALLBACK_MODEL: "whisper-1",
      OPENAI_HIGHLIGHT_FALLBACK_MODEL: "gpt-5-nano",
      OPENAI_COMMENT_FALLBACK_MODEL: "gpt-5-nano",
      GEMINI_TEXT_MODEL: "gemini-3.5-flash-lite",
      GEMINI_COMMENT_MODEL: "gemini-2.5-flash-lite",
      GEMINI_PAID_DATA_PROCESSING_CONFIRMED: "true",
      OPENAI_TRANSCRIBE_CHUNK_SECONDS: "30",
      OPENAI_TRANSCRIBE_MAX_WORKERS: "4",
      FFMPEG_THREADS: "2",
      EDIT_TIMELINE_CAPTURE_ENABLED: "true",
      TASK_VCPUS: "4",
      MAX_VIDEO_DURATION_SECONDS: "10800",
      EDITOR_RELEASE_GIT_SHA: sourceSha,
      EDITOR_RENDER_SPEC_VERSION: "4",
      EDITOR_CAPTION_RENDER_SPEC_VERSION: "4",
      EDITOR_FONT_MANIFEST_SHA256: fontManifestSha256,
      WORKER_IMAGE_DIGEST: digest,
      FILE_UPLOAD_SCALE_IN_PROTECTION_REQUIRED: "true",
      SOURCE_STORAGE_MODE: "ephemeral_only",
      TEMP_ROOT: "/scratch/shorts-jobs",
      TMPDIR: "/scratch/shorts-jobs",
      XDG_CACHE_HOME: "/scratch/shorts-jobs/.cache",
    })) {
      expect(taskDefinition).toContain(`\"Name\":\"${name}\"`);
      expect(taskDefinition).toContain(`\"Value\":\"${value}\"`);
    }
    expect(taskDefinition).toContain("https://www.easycut.co.kr,https://easycut.co.kr");

    const policyResources = template.findResources("AWS::IAM::Policy");
    const policies = JSON.stringify(policyResources);
    expect(policies).toContain("s3:GetObject");
    expect(policies).toContain("secretsmanager:GetSecretValue");
    expect(policies).not.toMatch(/shorts-mvp-production-media\/(?:raw|source|original)/);
    expect(policies).not.toContain(":s3:::shorts-mvp-production-media/*");
    const taskRolePolicy = Object.values(policyResources).find((resource) => (
      JSON.stringify(resource.Properties?.Roles || []).includes("TaskRole")
    ));
    expect(taskRolePolicy).toBeTruthy();
    expect(JSON.stringify(taskRolePolicy)).not.toContain("secretsmanager:GetSecretValue");
    expect(JSON.stringify(taskRolePolicy)).not.toContain("secretsmanager:DescribeSecret");
  });

  it("keeps the ALB private and requires both CloudFront identity checks", () => {
    const template = stackTemplate();

    for (const securityGroup of Object.values(
      template.findResources("AWS::EC2::SecurityGroup"),
    )) {
      expect(JSON.stringify(securityGroup.Properties?.SecurityGroupIngress || []))
        .not.toContain("0.0.0.0/0");
    }

    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 2);
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      SourcePrefixListId: "pl-1234abcd",
      FromPort: 80,
      ToPort: 80,
      IpProtocol: "tcp",
    });
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: "ALB-only ingress and bounded file-upload receiver egress",
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({ FromPort: 443, ToPort: 443, IpProtocol: "tcp" }),
        Match.objectLike({ FromPort: 5432, ToPort: 5432, IpProtocol: "tcp" }),
        Match.objectLike({ FromPort: 6543, ToPort: 6543, IpProtocol: "tcp" }),
        Match.objectLike({ FromPort: 53, ToPort: 53, IpProtocol: "udp" }),
        Match.objectLike({ FromPort: 53, ToPort: 53, IpProtocol: "tcp" }),
      ]),
    });
    const ingress = JSON.stringify(
      template.findResources("AWS::EC2::SecurityGroupIngress"),
    );
    expect(ingress).not.toContain('"CidrIp":"0.0.0.0/0"');
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      SourceSecurityGroupId: Match.anyValue(),
      FromPort: 8080,
      ToPort: 8080,
      IpProtocol: "tcp",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      DefaultActions: [Match.objectLike({
        Type: "fixed-response",
        FixedResponseConfig: Match.objectLike({ StatusCode: "403" }),
      })],
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Priority: 1,
      Conditions: Match.arrayWith([Match.objectLike({
        Field: "http-header",
        HttpHeaderConfig: {
          HttpHeaderName: "x-easycut-origin-verify",
          Values: [originSecret],
        },
      })]),
      Actions: Match.arrayWith([Match.objectLike({ Type: "forward" })]),
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internal",
      LoadBalancerAttributes: Match.arrayWith([{
        Key: "idle_timeout.timeout_seconds",
        Value: "4000",
      }]),
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/readyz",
      HealthCheckIntervalSeconds: 5,
      HealthCheckTimeoutSeconds: 2,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 2,
      TargetGroupAttributes: Match.arrayWith([{
        Key: "load_balancing.algorithm.type",
        Value: "least_outstanding_requests",
      }]),
      Port: 8080,
      TargetType: "ip",
    });
  });

  it("exposes a no-cache HTTPS CloudFront endpoint with every upload method", () => {
    const template = stackTemplate();

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          AllowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
          CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
          OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
          ViewerProtocolPolicy: "redirect-to-https",
        }),
        Origins: Match.arrayWith([Match.objectLike({
          OriginCustomHeaders: [{
            HeaderName: "x-easycut-origin-verify",
            HeaderValue: originSecret,
          }],
          VpcOriginConfig: Match.objectLike({
            OriginKeepaliveTimeout: 120,
            OriginReadTimeout: 120,
            VpcOriginId: Match.anyValue(),
          }),
        })]),
      },
    });
    template.resourceCountIs("AWS::CloudFront::VpcOrigin", 1);
    const rendered = template.toJSON();
    const resources = rendered.Resources as Record<string, {
      Type: string;
      DependsOn?: string[];
      Properties?: Record<string, unknown>;
    }>;
    const gatewayAttachmentId = Object.entries(resources).find(
      ([, resource]) => resource.Type === "AWS::EC2::VPCGatewayAttachment",
    )?.[0];
    const vpcOrigin = Object.values(resources).find(
      (resource) => resource.Type === "AWS::CloudFront::VpcOrigin",
    );
    expect(gatewayAttachmentId).toBeTruthy();
    expect(vpcOrigin?.DependsOn).toContain(gatewayAttachmentId);
    expect(vpcOrigin?.Properties).toMatchObject({
      VpcOriginEndpointConfig: {
        HTTPPort: 80,
        OriginProtocolPolicy: "http-only",
      },
    });
    const outputs = template.toJSON().Outputs || {};
    expect(outputs).toHaveProperty("FileUploadReceiverUrl");
    expect(outputs).toHaveProperty("FileUploadClusterName");
    expect(outputs).toHaveProperty("FileUploadServiceName");
    expect(outputs).toHaveProperty("FileUploadCapacityFunctionArn");
  });

  it("coordinates zero-to-twenty capacity with expiring leases and reconciliation", () => {
    const template = stackTemplate();

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      TimeToLiveSpecification: {
        AttributeName: "expiresAtEpoch",
        Enabled: true,
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "shorts-mvp-file-upload-capacity-production",
      ReservedConcurrentExecutions: 1,
      Environment: {
        Variables: Match.objectLike({
          ECS_CLUSTER: "shorts-mvp-file-upload-production",
          ECS_SERVICE: "shorts-mvp-file-upload-production",
          TARGET_GROUP_ARN: Match.anyValue(),
          MAX_CAPACITY: "20",
          WARM_SECONDS: "600",
          UPLOAD_WINDOW_SECONDS: "900",
          CLAIMED_LEASE_SECONDS: "21600",
        }),
      },
      Runtime: "python3.12",
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
      State: "ENABLED",
    });
    const rendered = JSON.stringify(template.toJSON());
    expect(rendered).toContain("ecs:UpdateTaskProtection");
    expect(rendered).toContain("ecs:GetTaskProtection");
    expect(rendered).toContain("ecs:DescribeTasks");
    expect(rendered).toContain("ecs:UpdateService");
    expect(rendered).toContain("elasticloadbalancing:DescribeTargetHealth");
    expect(rendered).toContain("dynamodb:DeleteItem");
    expect(rendered).toContain("FILE_UPLOAD_CAPACITY_FUNCTION_ARN");
    const invokePolicies = Object.values(
      template.findResources("AWS::IAM::Policy"),
    ).filter((resource) => JSON.stringify(resource).includes("lambda:InvokeFunction"));
    expect(invokePolicies.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(invokePolicies)).toContain(
      "shorts-mvp-production-vercel-control-plane",
    );
  });

  it("keeps preview CORS disabled unless one exact deployment origin is explicit", () => {
    const defaultTask = JSON.stringify(Object.values(
      stackTemplate().findResources("AWS::ECS::TaskDefinition"),
    )[0]);
    expect(defaultTask).toContain(
      '\"Name\":\"FILE_UPLOAD_SOCKET_IDLE_TIMEOUT_SECONDS\",\"Value\":\"120\"',
    );
    expect(defaultTask).not.toContain("FILE_UPLOAD_CORS_PREVIEW_HOST_SUFFIX");

    const previewTask = JSON.stringify(Object.values(
      stackTemplate({
        fileUploadPreviewOrigin: "https://shorts-ab12cd34-artiroom.vercel.app",
      }).findResources("AWS::ECS::TaskDefinition"),
    )[0]);
    expect(previewTask).toContain("https://shorts-ab12cd34-artiroom.vercel.app");
    expect(previewTask).not.toContain("FILE_UPLOAD_CORS_PREVIEW_HOST_SUFFIX");
    expect(() => stackTemplate({
      fileUploadPreviewOrigin: "https://vercel.app",
    })).toThrow("fileUploadPreviewOrigin must be one exact HTTPS Vercel deployment origin");
    expect(() => stackTemplate({
      fileUploadPreviewOrigin: "http://shorts-ab12cd34-artiroom.vercel.app",
    })).toThrow("fileUploadPreviewOrigin must be one exact HTTPS Vercel deployment origin");
    for (const value of [
      "https://shorts-ab12cd34-artiroom.vercel.app/path",
      "https://shorts-ab12cd34-artiroom.vercel.app:444",
      "https://user@shorts-ab12cd34-artiroom.vercel.app",
      "https://shorts-ab12cd34-artiroom.vercel.app?preview=1",
    ]) {
      expect(() => stackTemplate({ fileUploadPreviewOrigin: value })).toThrow(
        "fileUploadPreviewOrigin must be one exact HTTPS Vercel deployment origin",
      );
    }
  });
});
