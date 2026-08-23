import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface FileUploadCanaryProps extends cdk.StackProps {
  environment: string;
}

const ORIGIN_VERIFY_HEADER_NAME = "x-easycut-origin-verify";
const RECEIVER_PORT = 8080;
const FILE_UPLOAD_CORS_ALLOWED_ORIGINS = [
  "https://www.easycut.co.kr",
  "https://easycut.co.kr",
];
const CLOUDFRONT_ORIGIN_TIMEOUT_SECONDS = 60;

function requiredContext(stack: cdk.Stack, name: string) {
  const value = String(stack.node.tryGetContext(name) || "").trim();
  if (!value) throw new Error(`${name} context is required`);
  return value;
}

function validateContext(stack: cdk.Stack) {
  const repositoryUri = requiredContext(stack, "repositoryUri");
  const repositoryMatch = repositoryUri.match(
    /^([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9._/-]+)$/,
  );
  if (repositoryUri.includes("@") || repositoryUri.includes(":latest") || !repositoryMatch) {
    throw new Error("repositoryUri must be an untagged private ECR repository URI");
  }
  const imageDigest = requiredContext(stack, "imageDigest");
  if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
    throw new Error("imageDigest must be an immutable sha256 digest");
  }
  const runtimeSecretArn = requiredContext(stack, "runtimeSecretArn");
  if (!/^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:.+/.test(runtimeSecretArn)) {
    throw new Error("runtimeSecretArn must be a complete Secrets Manager ARN");
  }
  const mediaBucketName = requiredContext(stack, "mediaBucketName");
  const cloudfrontPrefixListId = requiredContext(stack, "cloudfrontPrefixListId");
  if (!/^pl-[0-9a-f]+$/.test(cloudfrontPrefixListId)) {
    throw new Error("cloudfrontPrefixListId must be a managed prefix list ID");
  }
  const originVerifyHeader = requiredContext(stack, "originVerifyHeader");
  if (
    originVerifyHeader.length < 32
    || originVerifyHeader.length > 256
    || /\s/.test(originVerifyHeader)
  ) {
    throw new Error(
      "originVerifyHeader must be a non-whitespace secret from 32 to 256 characters",
    );
  }
  const previewOrigin = String(
    stack.node.tryGetContext("fileUploadPreviewOrigin") || "",
  ).trim().toLowerCase();
  if (
    previewOrigin
    && !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?\.vercel\.app$/.test(
      previewOrigin,
    )
  ) {
    throw new Error(
      "fileUploadPreviewOrigin must be one exact HTTPS Vercel deployment origin",
    );
  }
  const desiredCountRaw = stack.node.tryGetContext("fileUploadDesiredCount");
  const desiredCountText = desiredCountRaw === undefined
    ? "0"
    : String(desiredCountRaw).trim();
  if (desiredCountText !== "0" && desiredCountText !== "1") {
    throw new Error("fileUploadDesiredCount must be exactly 0 or 1");
  }
  return {
    repositoryUri,
    repositoryAccount: repositoryMatch[1],
    repositoryRegion: repositoryMatch[2],
    repositoryName: repositoryMatch[3],
    imageDigest,
    runtimeSecretArn,
    mediaBucketName,
    cloudfrontPrefixListId,
    originVerifyHeader,
    previewOrigin,
    desiredCount: Number(desiredCountText),
  };
}

export function fileUploadCanaryIncluded(value: unknown) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

/**
 * Isolated administrator file-upload receiver. It has its own network and ECS
 * service, imports only immutable/shared identities, and cannot write raw
 * source objects to S3. CloudFront's maximum origin timeouts improve tolerance
 * but do not prove multi-hour request-body behavior; a candidate end-to-end
 * upload is mandatory before this stack is enabled outside administrators.
 */
export class ShortsMvpFileUploadCanaryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FileUploadCanaryProps) {
    super(scope, id, props);
    const context = validateContext(this);

    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `shorts-mvp-file-upload-${props.environment}`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "PublicReceiver",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }, {
        name: "PrivateLoadBalancer",
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      }],
    });

    const ephemeralStorageKey = new kms.Key(this, "EphemeralStorageKey", {
      alias: `alias/shorts-mvp-file-upload-${props.environment}`,
      description: "ECS Fargate file-upload canary ephemeral storage encryption",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: `shorts-mvp-file-upload-${props.environment}`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      managedStorageConfiguration: {
        fargateEphemeralStorageKmsKey: ephemeralStorageKey,
      },
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "CloudFront-prefix ingress and receiver-only egress",
    });
    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(context.cloudfrontPrefixListId),
      ec2.Port.tcp(80),
      "CloudFront managed origin-facing prefix only",
    );

    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "ALB-only ingress and bounded file-upload receiver egress",
    });
    taskSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(RECEIVER_PORT),
      "Receiver traffic from the canary ALB only",
    );
    albSecurityGroup.addEgressRule(
      taskSecurityGroup,
      ec2.Port.tcp(RECEIVER_PORT),
      "Forward only to the receiver task",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS APIs, ECR, Secrets Manager, and allowed media objects",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Supabase PostgreSQL",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6543),
      "Supabase transaction pooler",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(53),
      "VPC DNS UDP",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(53),
      "VPC DNS TCP",
    );

    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "File-upload canary task role without raw-source S3 access",
    });
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      )],
    });
    const mediaBucket = s3.Bucket.fromBucketName(
      this,
      "MediaBucket",
      context.mediaBucketName,
    );
    const allowedPrefixes = ["outputs/", "thumbnails/", "edit-sources/"];
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: "DerivedMediaObjectsOnly",
      actions: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
      ],
      resources: allowedPrefixes.map((prefix) => `${mediaBucket.bucketArn}/${prefix}*`),
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: "ListDerivedMediaPrefixesOnly",
      actions: ["s3:ListBucket"],
      resources: [mediaBucket.bucketArn],
      conditions: { StringLike: { "s3:prefix": allowedPrefixes.map((prefix) => `${prefix}*`) } },
    }));

    const runtimeSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "RuntimeSecret",
      context.runtimeSecretArn,
    );
    // Only the ECS agent may resolve the explicitly named values below. The
    // application task role cannot fetch the JSON secret or enumerate any
    // unrelated worker credentials at runtime.
    runtimeSecret.grantRead(executionRole);

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDefinition", {
      family: `shorts-mvp-file-upload-${props.environment}`,
      cpu: 4096,
      memoryLimitMiB: 8192,
      ephemeralStorageGiB: 80,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/shorts-mvp/${props.environment}/file-upload-canary`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const workerRepository = ecr.Repository.fromRepositoryAttributes(
      this,
      "WorkerRepository",
      {
        repositoryName: context.repositoryName,
        repositoryArn: cdk.Stack.of(this).formatArn({
          account: context.repositoryAccount,
          region: context.repositoryRegion,
          service: "ecr",
          resource: "repository",
          resourceName: context.repositoryName,
        }),
      },
    );
    const container = taskDefinition.addContainer("Receiver", {
      containerName: "file-upload-receiver",
      image: ecs.ContainerImage.fromEcrRepository(workerRepository, context.imageDigest),
      command: ["python", "-m", "shorts_worker.upload_service"],
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "receiver",
      }),
      environment: {
        AWS_REGION: this.region,
        AWS_DEFAULT_REGION: this.region,
        AWS_S3_OUTPUT_BUCKET: context.mediaBucketName,
        FILE_UPLOAD_RECEIVER_ENABLED: "true",
        FILE_UPLOAD_MAX_BYTES: String(5 * 1024 * 1024 * 1024),
        FILE_UPLOAD_MAX_DURATION_SECONDS: String(3 * 60 * 60),
        FILE_UPLOAD_MAX_SELECTED_SECONDS: String(60 * 60),
        FILE_UPLOAD_CORS_ALLOWED_ORIGINS: [
          ...FILE_UPLOAD_CORS_ALLOWED_ORIGINS,
          ...(context.previewOrigin ? [context.previewOrigin] : []),
        ].join(","),
        FILE_UPLOAD_SOCKET_IDLE_TIMEOUT_SECONDS: "120",
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
        CLEAN_CLIP_PRESET: "superfast",
        CLEAN_CLIP_CRF: "20",
        EDIT_TIMELINE_CAPTURE_ENABLED: "true",
        TASK_VCPUS: "4",
        MAX_VIDEO_DURATION_SECONDS: "10800",
        PORT: String(RECEIVER_PORT),
        PROJECT_RESOURCE_TIER: "file_upload_canary",
        SOURCE_STORAGE_MODE: "ephemeral_only",
        TEMP_ROOT: "/tmp/shorts-jobs",
        WORKER_IMAGE_TAG: context.imageDigest,
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(runtimeSecret, "DATABASE_URL"),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(runtimeSecret, "OPENAI_API_KEY"),
        GEMINI_API_KEY: ecs.Secret.fromSecretsManager(runtimeSecret, "GEMINI_API_KEY"),
        GEMINI_OPENAI_BASE_URL: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          "GEMINI_OPENAI_BASE_URL",
        ),
        ELEVENLABS_API_KEY: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          "ELEVENLABS_API_KEY",
        ),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          `python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:${RECEIVER_PORT}/healthz',timeout=3)\" || exit 1`,
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
      stopTimeout: cdk.Duration.seconds(120),
    });
    container.addPortMappings({
      name: "receiver-http",
      containerPort: RECEIVER_PORT,
      protocol: ecs.Protocol.TCP,
    });

    const service = new ecs.FargateService(this, "Service", {
      serviceName: `shorts-mvp-file-upload-${props.environment}`,
      cluster,
      taskDefinition,
      // A new stack is intentionally cold until quotas, exact preview CORS,
      // migrations, and the administrator-only gate have all been verified.
      desiredCount: context.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [taskSecurityGroup],
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.minutes(2),
      enableExecuteCommand: false,
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: false,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    loadBalancer.setAttribute("idle_timeout.timeout_seconds", "4000");
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: RECEIVER_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: cdk.Duration.minutes(5),
      healthCheck: {
        enabled: true,
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        path: "/healthz",
        timeout: cdk.Duration.seconds(5),
      },
    });
    targetGroup.addTarget(service.loadBalancerTarget({
      containerName: container.containerName,
      containerPort: RECEIVER_PORT,
    }));
    const listener = loadBalancer.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: "application/json",
        messageBody: '{"detail":"Forbidden"}',
      }),
    });
    listener.addAction("VerifiedCloudFrontForward", {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader(
        ORIGIN_VERIFY_HEADER_NAME,
        [context.originVerifyHeader],
      )],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    const privateVpcOrigin = new cloudfront.VpcOrigin(this, "PrivateVpcOrigin", {
      endpoint: cloudfront.VpcOriginEndpoint.applicationLoadBalancer(loadBalancer),
      vpcOriginName: `shorts-mvp-file-upload-${props.environment}`,
      httpPort: 80,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });
    // AWS requires the VPC internet gateway to be attached before it accepts a
    // VPC Origin, even though viewer traffic uses the private service ENIs.
    privateVpcOrigin.node.addDependency(vpc.internetConnectivityEstablished);
    const gatewayAttachment = vpc.node.tryFindChild("VPCGW");
    if (!gatewayAttachment) {
      throw new Error("file-upload VPC internet gateway attachment is required");
    }
    privateVpcOrigin.node.addDependency(gatewayAttachment);

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `Administrator file-upload receiver (${props.environment})`,
      defaultBehavior: {
        origin: origins.VpcOrigin.withVpcOrigin(privateVpcOrigin, {
          customHeaders: {
            [ORIGIN_VERIFY_HEADER_NAME]: context.originVerifyHeader,
          },
          // Keep the default account-safe ceiling. This does not prove long
          // request-body support; a large upload against the unaliased
          // candidate distribution is mandatory before the runtime gate opens.
          readTimeout: cdk.Duration.seconds(CLOUDFRONT_ORIGIN_TIMEOUT_SECONDS),
          keepaliveTimeout: cdk.Duration.seconds(CLOUDFRONT_ORIGIN_TIMEOUT_SECONDS),
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    new cdk.CfnOutput(this, "FileUploadReceiverUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, "FileUploadClusterName", {
      value: cluster.clusterName,
    });
    new cdk.CfnOutput(this, "FileUploadServiceName", {
      value: service.serviceName,
    });
  }
}
