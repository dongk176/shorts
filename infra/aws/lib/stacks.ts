import * as fs from "node:fs";
import * as path from "node:path";
import * as batch from "aws-cdk-lib/aws-batch";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DOWNLOAD_RESPONSE_HEADERS_FUNCTION_CODE } from "./cloudfront-functions";

const projectRoot = path.resolve(__dirname, "../../..");
const pinnedBatchJobDefinitionArn = /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition\/[A-Za-z0-9_-]+:[1-9][0-9]*$/;
const pinnedBatchQueueArn = /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue\/[A-Za-z0-9_-]+$/;
const placeholderPublicKey = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvrVZ6+TqXL7EtZYYN2HN",
  "dte1eM4V7m8mPQyOaFEhbjT9A30z9Q2Hj3q7S2X4c9ZL6oVdpJLKxq2q7pJf6tQN",
  "i2A5wBty7QWfYZU6qK6cH3ePzQyQc+Op0wD4fS1vU2iX6R1O8E2lPq0IuWnJArxP",
  "5zxWq7pAZyGvJi9JmWQXlZVq6A8ThxTt8j0Cckr7hO0Zf0GCFIavj1l8jQzpP+aB",
  "VZlVCFeu2ZUK5qJ1HYoNfGNnDJ4M2j3b8kFjUrxnmBfCO/uwrDgNdSYv2L8mWQ9o",
  "4sx/8EwEMpM7JPH2nYS4b2QCG2vfHcEJmQ9OeP8TQ/3o0VxVqB5D6mQd6QIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

interface BaseProps extends cdk.StackProps {
  environment: string;
}

interface FoundationProps extends BaseProps {
  editorReleaseRepository: ecr.IRepository;
}

export class ShortsMvpEditorReleaseRepositoryStack extends cdk.Stack {
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: BaseProps) {
    super(scope, id, props);
    this.repository = new ecr.Repository(this, "EditorReleaseRepository", {
      repositoryName: `shorts-mvp-editor-releases-${props.environment}`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // Release images are intentionally not age-expired. The active,
      // previous stable, and candidate pointers may remain valid longer than
      // 30 days; deletion is a release-aware maintenance operation.
    });

    new cdk.CfnOutput(this, "EditorReleaseRepositoryUri", {
      value: this.repository.repositoryUri,
    });
  }
}

function requiredContext(stack: cdk.Stack, name: string): string {
  const value = String(stack.node.tryGetContext(name) || "").trim();
  if (!value) {
    throw new Error(`${name} context is required`);
  }
  return value;
}

export class ShortsMvpFoundationStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly repository: ecr.Repository;
  readonly editorReleaseRepository: ecr.IRepository;
  readonly runtimeSecret: secretsmanager.Secret;
  readonly distribution: cloudfront.Distribution;
  readonly keyPairId: string;

  constructor(scope: Construct, id: string, props: FoundationProps) {
    super(scope, id, props);
    this.bucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [{
        id: "AbortIncompleteMediaUploads",
        enabled: true,
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      }, ...[
        ["ExpireOutputs", "outputs/"],
        ["ExpireThumbnails", "thumbnails/"],
        ["ExpireEditSources", "edit-sources/"],
      ].map(([id, prefix]) => ({
        id,
        prefix,
        enabled: true,
        expiration: cdk.Duration.days(30),
      }))],
    });
    this.repository = new ecr.Repository(this, "WorkerRepository", {
      repositoryName: `shorts-mvp-worker-${props.environment}`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          rulePriority: 1,
          tagPrefixList: ["legacy-rerender-"],
          maxImageCount: 10_000,
          description: "Protect explicitly pinned legacy rerender images",
        },
        {
          rulePriority: 2,
          maxImageCount: 16,
          description: "Keep recent prepare and render images",
        },
      ],
    });
    this.editorReleaseRepository = props.editorReleaseRepository;
    this.runtimeSecret = new secretsmanager.Secret(this, "WorkerRuntimeSecret", {
      secretName: `shorts-mvp/${props.environment}/worker-runtime`,
      description: "Server-only runtime values for the Shorts MVP worker and cleanup Lambdas",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          DATABASE_URL: "",
          SUPABASE_URL: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
          OPENAI_API_KEY: "",
          GEMINI_API_KEY: "",
          GEMINI_OPENAI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
          YOUTUBE_API_KEY: "",
          INGESTION_PROXY_ROUTES_JSON: "",
          WARP_CONF_B64: "",
          WARP_CONF_A_B64: "",
          WARP_CONF_B_B64: "",
          WARP_CONF_C_B64: "",
          WARP_CONF_D_B64: "",
        }),
        generateStringKey: "_bootstrap",
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const publicKeyFile = path.join(projectRoot, ".secrets", "cloudfront-public.pem");
    const publicKeyPem = fs.existsSync(publicKeyFile)
      ? fs.readFileSync(publicKeyFile, "utf8")
      : placeholderPublicKey;
    const publicKey = new cloudfront.PublicKey(this, "SigningPublicKey", {
      encodedKey: publicKeyPem,
      comment: `shorts-mvp ${props.environment} signed URLs`,
    });
    const keyGroup = new cloudfront.KeyGroup(this, "SigningKeyGroup", { items: [publicKey] });
    const outputOnly = new cloudfront.Function(this, "OutputPrefixGuard", {
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event){var r=event.request;if(!r.uri.startsWith('/outputs/')&&!r.uri.startsWith('/thumbnails/')&&!r.uri.startsWith('/examples/')&&!r.uri.startsWith('/edit-sources/'))return {statusCode:403,statusDescription:'Forbidden'};return r;}"
      ),
    });
    const downloadHeaders = new cloudfront.Function(this, "DownloadResponseHeaders", {
      code: cloudfront.FunctionCode.fromInline(
        DOWNLOAD_RESPONSE_HEADERS_FUNCTION_CODE,
      ),
    });
    const mediaHeaders = new cloudfront.ResponseHeadersPolicy(this, "MediaResponseHeaders", {
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: ["*"],
        accessControlAllowMethods: ["GET", "HEAD"],
        accessControlAllowOrigins: ["*"],
        accessControlExposeHeaders: ["Content-Length", "Content-Range"],
        originOverride: true,
      },
    });
    this.distribution = new cloudfront.Distribution(this, "MediaDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: mediaHeaders,
        trustedKeyGroups: [keyGroup],
        functionAssociations: [{
          function: outputOnly,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }, {
          function: downloadHeaders,
          eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
        }],
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      comment: `Private Shorts MVP outputs (${props.environment})`,
    });
    this.keyPairId = publicKey.publicKeyId;

    new cdk.CfnOutput(this, "MediaBucketName", { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, "WorkerRepositoryUri", { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, "EditorReleaseRepositoryUri", {
      value: this.editorReleaseRepository.repositoryUri,
    });
    new cdk.CfnOutput(this, "RuntimeSecretArn", { value: this.runtimeSecret.secretArn });
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: this.distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, "CloudFrontKeyPairId", { value: publicKey.publicKeyId });
  }
}

interface ComputeProps extends BaseProps {
  foundation: ShortsMvpFoundationStack;
}

export class ShortsMvpEditorCanaryStack extends cdk.Stack {
  readonly queue: batch.CfnJobQueue;

  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id, props);
    const { bucket, editorReleaseRepository, runtimeSecret } = props.foundation;
    const vpc = new ec2.Vpc(this, "EditorCanaryVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "EditorCanaryWorkers",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }],
    });
    const subnetIds = vpc.selectSubnets({
      subnetGroupName: "EditorCanaryWorkers",
    }).subnetIds;
    const securityGroup = new ec2.SecurityGroup(this, "EditorCanarySecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "No inbound traffic; editor canary worker egress only",
    });
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), "Production Postgres",
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(), ec2.Port.tcp(6543), "Production Postgres pooler",
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.udp(53), "VPC DNS UDP",
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(53), "VPC DNS TCP",
    );
    const compute = new batch.CfnComputeEnvironment(this, "EditorCanaryCompute", {
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        type: "FARGATE",
        maxvCpus: 4,
        subnets: subnetIds,
        securityGroupIds: [securityGroup.securityGroupId],
      },
    });
    this.queue = new batch.CfnJobQueue(this, "EditorCanaryQueue", {
      priority: 1,
      state: "ENABLED",
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
      jobQueueName: `shorts-mvp-editor-canary-${props.environment}`,
    });

    const dispatchDlq = new sqs.Queue(this, "EditorDispatchDlq", {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const dispatchQueue = new sqs.Queue(this, "EditorDispatchQueue", {
      visibilityTimeout: cdk.Duration.minutes(2),
      retentionPeriod: cdk.Duration.days(2),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: dispatchDlq, maxReceiveCount: 5 },
    });
    const lambdaRole = new iam.Role(this, "EditorCanaryLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
    runtimeSecret.grantRead(lambdaRole);
    dispatchQueue.grantConsumeMessages(lambdaRole);
    dispatchQueue.grantSendMessages(lambdaRole);
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "batch:DescribeJobDefinitions",
        "batch:DescribeJobs",
        "batch:ListJobs",
        "batch:SubmitJob",
      ],
      resources: ["*"],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:DescribeImageScanFindings"],
      resources: [editorReleaseRepository.repositoryArn],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [this.formatArn({
        service: "s3",
        region: "",
        account: "",
        resource: `shorts-mvp-editor-test-${this.account}-${this.region}`,
        resourceName: "editor-release-probes/*",
        arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
      })],
    }));
    const environment = {
      RUNTIME_SECRET_ARN: runtimeSecret.secretArn,
      MEDIA_BUCKET: bucket.bucketName,
      PROJECT_BATCH_QUEUE: `shorts-mvp-project-fargate-${props.environment}`,
      EDITOR_STABLE_BATCH_QUEUE:
        `shorts-mvp-project-fargate-${props.environment}`,
      EDITOR_CANARY_BATCH_QUEUE: this.queue.ref,
      RERENDER_JOB_DEFINITION:
        `shorts-mvp-rerender-fargate-${props.environment}`,
      EDITOR_TEST_BUCKET_NAME:
        `shorts-mvp-editor-test-${this.account}-${this.region}`,
      EDITOR_TEST_TEMPLATE_JOB_DEFINITION:
        "shorts-mvp-editor-test-template",
      EDITOR_WORK_DISPATCH_QUEUE_URL: dispatchQueue.queueUrl,
      WORK_DISPATCH_QUEUE_URL: dispatchQueue.queueUrl,
    };
    const lambdaCode = lambda.Code.fromAsset(path.join(__dirname, "../lambda"), {
      exclude: ["__pycache__", "*.pyc"],
    });
    const outboxDispatcher = new lambda.Function(
      this,
      "EditorOutboxDispatcherFunction",
      {
        functionName: `shorts-mvp-editor-outbox-${props.environment}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "editor_outbox_dispatcher.handler",
        code: lambdaCode,
        role: lambdaRole,
        timeout: cdk.Duration.seconds(60),
        memorySize: 256,
        environment,
      },
    );
    const batchSubmitter = new lambda.Function(
      this,
      "EditorBatchSubmitterFunction",
      {
        functionName: `shorts-mvp-editor-batch-submitter-${props.environment}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "batch_submitter.handler",
        code: lambdaCode,
        role: lambdaRole,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        reservedConcurrentExecutions: 2,
        environment,
      },
    );
    const batchState = new lambda.Function(this, "EditorBatchStateFunction", {
      functionName: `shorts-mvp-editor-batch-state-${props.environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "batch_state.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment,
    });
    const cleanup = new lambda.Function(this, "EditorCleanupFunction", {
      functionName: `shorts-mvp-editor-cleanup-${props.environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "editor_cleanup.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment,
    });
    const registrar = new lambda.Function(this, "EditorReleaseRegistrarFunction", {
      functionName: `shorts-mvp-editor-release-registrar-${props.environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "editor_release_registrar.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment,
    });
    batchSubmitter.addEventSource(new lambdaEventSources.SqsEventSource(
      dispatchQueue,
      { batchSize: 1, reportBatchItemFailures: true },
    ));
    new events.Rule(this, "EditorOutboxSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(outboxDispatcher)],
    });
    new events.Rule(this, "EditorCleanupSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new targets.LambdaFunction(cleanup)],
    });
    new events.Rule(this, "EditorBatchStateEvents", {
      eventPattern: {
        source: ["aws.batch"],
        detailType: ["Batch Job State Change"],
        detail: {
          status: ["SUCCEEDED", "FAILED"],
          jobQueue: [this.queue.ref],
        },
      },
      targets: [new targets.LambdaFunction(batchState)],
    });

    const githubOrg = this.node.tryGetContext("githubOrg") || "dongk176";
    const githubRepo = this.node.tryGetContext("githubRepo") || "shorts";
    const githubProviderArn = this.node.tryGetContext("githubOidcProviderArn");
    const githubProvider = githubProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "ImportedGithubOidcProvider",
          githubProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });
    const githubRole = new iam.Role(this, "EditorReleaseBuildRole", {
      assumedBy: new iam.OpenIdConnectPrincipal(githubProvider).withConditions({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": [
            `repo:${githubOrg}/${githubRepo}:ref:refs/heads/main`,
            `repo:${githubOrg}/${githubRepo}:ref:refs/heads/codex/unified-template-subtitles-admin-canary-20260824`,
          ],
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    editorReleaseRepository.grantPullPush(githubRole);
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));
    registrar.grantInvoke(githubRole);
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "batch:DescribeJobDefinitions",
        "batch:DescribeJobs",
        "batch:RegisterJobDefinition",
      ],
      resources: ["*"],
    }));
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["batch:TagResource"],
      resources: [
        this.formatArn({
          service: "batch",
          resource: "job-definition",
          resourceName: "shorts-mvp-editor-release-*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
        this.formatArn({
          service: "batch",
          resource: "job-definition",
          resourceName: "shorts-mvp-editor-test-release-*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
      ],
    }));
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["batch:SubmitJob"],
      resources: [
        this.queue.attrJobQueueArn,
        this.formatArn({
          service: "batch",
          resource: "job-queue",
          resourceName: "shorts-mvp-editor-test",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
        this.formatArn({
          service: "batch",
          resource: "job-definition",
          resourceName: "shorts-mvp-editor-release-*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
        this.formatArn({
          service: "batch",
          resource: "job-definition",
          resourceName: "shorts-mvp-editor-test-release-*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
      ],
    }));
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:DescribeImages", "ecr:DescribeImageScanFindings"],
      resources: [editorReleaseRepository.repositoryArn],
    }));
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [
        this.formatArn({
          service: "iam",
          region: "",
          resource: "role",
          resourceName: "ShortsMvpCompute-production-Worker*Role*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
        this.formatArn({
          service: "iam",
          region: "",
          resource: "role",
          resourceName: "shorts-mvp-editor-test-*",
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
      ],
      conditions: {
        StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
      },
    }));

    new cdk.CfnOutput(this, "EditorCanaryBatchJobQueue", {
      value: this.queue.ref,
    });
    new cdk.CfnOutput(this, "EditorReleaseRegistrarFunctionArn", {
      value: registrar.functionArn,
    });
    new cdk.CfnOutput(this, "EditorReleaseBuildRoleArn", {
      value: githubRole.roleArn,
    });
  }
}

export class ShortsMvpComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id, props);
    const {
      bucket,
      repository,
      runtimeSecret,
    } = props.foundation;
    const workerImageTag = String(
      this.node.tryGetContext("workerImageTag") || process.env.WORKER_IMAGE_TAG || "",
    );
    if (!workerImageTag || workerImageTag === "latest") {
      throw new Error(
        "workerImageTag must be an immutable published image tag; latest is not allowed",
      );
    }
    const legacyRerenderImageTag = String(
      this.node.tryGetContext("legacyRerenderImageTag")
        || process.env.LEGACY_RERENDER_IMAGE_TAG
        || "",
    );
    if (
      !legacyRerenderImageTag
      || legacyRerenderImageTag === "latest"
      || legacyRerenderImageTag === "latest-prepare"
    ) {
      throw new Error(
        "legacyRerenderImageTag must explicitly pin the known-good legacy rerender image",
      );
    }
    const prepareWorkerImageTag = `${workerImageTag}-prepare`;
    const vpc = new ec2.Vpc(this, "WorkerVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "PublicWorkers",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "ScaleWorkers",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 19,
        },
      ],
    });
    const workerSubnetIds = vpc.selectSubnets({
      subnetGroupName: "ScaleWorkers",
    }).subnetIds;
    const securityGroup = new ec2.SecurityGroup(this, "WorkerSecurityGroup", {
      vpc,
      description: "No inbound traffic; outbound HTTPS for Batch workers",
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS only");
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(), ec2.Port.tcpRange(1000, 9999),
      "Dedicated ISP proxy direct connections"
    );
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), "Supabase Postgres");
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6543), "Supabase pooler");
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.udp(53), "VPC DNS UDP"
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(53), "VPC DNS TCP"
    );

    const workerLogGroup = new logs.LogGroup(this, "WorkerLogs", {
      logGroupName: `/shorts-mvp/${props.environment}/worker`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const taskRole = new iam.Role(this, "WorkerTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    bucket.grantReadWrite(taskRole, "outputs/*");
    bucket.grantReadWrite(taskRole, "thumbnails/*");
    bucket.grantReadWrite(taskRole, "edit-sources/*");
    runtimeSecret.grantRead(taskRole);
    const executionRole = new iam.Role(this, "WorkerExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });
    runtimeSecret.grantRead(executionRole);
    workerLogGroup.grantWrite(executionRole);

    const workDlq = new sqs.Queue(this, "WorkDispatchDlq", {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const workQueue = new sqs.Queue(this, "WorkDispatchQueue", {
      visibilityTimeout: cdk.Duration.minutes(3),
      retentionPeriod: cdk.Duration.days(1),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: workDlq, maxReceiveCount: 5 },
    });
    const stateQueue = new sqs.Queue(this, "StateEventQueue", {
      visibilityTimeout: cdk.Duration.minutes(2),
      retentionPeriod: cdk.Duration.days(1),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: workDlq, maxReceiveCount: 5 },
    });
    workQueue.grantSendMessages(taskRole);
    stateQueue.grantSendMessages(taskRole);

    const prepareMaxVcpus = Number(this.node.tryGetContext("prepareMaxVcpus") || 4000);
    const renderMaxVcpus = Number(this.node.tryGetContext("renderMaxVcpus") || 4000);
    const compute = new batch.CfnComputeEnvironment(this, "PrepareFargateCompute", {
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        type: "FARGATE",
        maxvCpus: prepareMaxVcpus,
        subnets: workerSubnetIds,
        securityGroupIds: [securityGroup.securityGroupId],
      },
    });
    const queue = new batch.CfnJobQueue(this, "PrepareJobQueue", {
      priority: 10,
      state: "ENABLED",
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
      jobQueueName: `shorts-mvp-prepare-${props.environment}`,
    });
    const projectSchedulingPolicy = new batch.CfnSchedulingPolicy(
      this,
      "ProjectFargateFairSharePolicy",
      {
        name: `shorts-mvp-project-fargate-fair-share-${props.environment}`,
        fairsharePolicy: {
          computeReservation: 10,
          shareDecaySeconds: 600,
          shareDistribution: [
            { shareIdentifier: "paid*", weightFactor: 0.25 },
            { shareIdentifier: "free*", weightFactor: 1 },
          ],
        },
      },
    );
    const projectQueue = new batch.CfnJobQueue(this, "ProjectFargateJobQueue", {
      priority: 20,
      state: "ENABLED",
      schedulingPolicyArn: projectSchedulingPolicy.attrArn,
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
      jobQueueName: `shorts-mvp-project-fargate-${props.environment}`,
    });
    const ecsInstanceRole = new iam.Role(this, "RenderEcsInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2ContainerServiceforEC2Role"),
      ],
    });
    const instanceProfile = new iam.CfnInstanceProfile(this, "RenderInstanceProfile", {
      roles: [ecsInstanceRole.roleName],
    });
    const renderResources = {
      maxvCpus: renderMaxVcpus,
      minvCpus: 0,
      desiredvCpus: 0,
      instanceTypes: ["default_x86_64"],
      instanceRole: instanceProfile.attrArn,
      subnets: workerSubnetIds,
      securityGroupIds: [securityGroup.securityGroupId],
      ec2Configuration: [{ imageType: "ECS_AL2023" }],
    };
    const renderSpot = new batch.CfnComputeEnvironment(this, "RenderSpotCompute", {
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        ...renderResources,
        type: "SPOT",
        allocationStrategy: "SPOT_PRICE_CAPACITY_OPTIMIZED",
      },
    });
    const renderOnDemand = new batch.CfnComputeEnvironment(this, "RenderOnDemandCompute", {
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        ...renderResources,
        type: "EC2",
        allocationStrategy: "BEST_FIT_PROGRESSIVE",
      },
    });
    const renderSchedulingPolicy = new batch.CfnSchedulingPolicy(
      this,
      "RenderFairSharePolicy",
      {
        name: `shorts-mvp-render-fair-share-${props.environment}`,
        fairsharePolicy: {
          computeReservation: 10,
          shareDecaySeconds: 600,
          shareDistribution: [
            { shareIdentifier: "paid*", weightFactor: 0.25 },
            { shareIdentifier: "free*", weightFactor: 1 },
          ],
        },
      },
    );
    const renderQueue = new batch.CfnJobQueue(this, "RenderFairShareJobQueue", {
      priority: 10,
      state: "ENABLED",
      schedulingPolicyArn: renderSchedulingPolicy.attrArn,
      computeEnvironmentOrder: [
        { order: 1, computeEnvironment: renderSpot.ref },
        { order: 2, computeEnvironment: renderOnDemand.ref },
      ],
      jobQueueName: `shorts-mvp-render-fair-${props.environment}`,
    });
    const secret = (key: string) => ({
      name: key,
      valueFrom: `${runtimeSecret.secretArn}:${key}::`,
    });
    const baseContainer = {
      executionRoleArn: executionRole.roleArn,
      jobRoleArn: taskRole.roleArn,
      networkConfiguration: { assignPublicIp: "ENABLED" },
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": workerLogGroup.logGroupName,
          "awslogs-region": this.region,
          "awslogs-stream-prefix": "job",
        },
      },
      environment: [
        { name: "AWS_REGION", value: this.region },
        { name: "AWS_DEFAULT_REGION", value: this.region },
        { name: "AWS_S3_OUTPUT_BUCKET", value: bucket.bucketName },
        { name: "TEMP_ROOT", value: "/tmp/shorts-jobs" },
        { name: "WORK_DISPATCH_QUEUE_URL", value: workQueue.queueUrl },
        { name: "STATE_EVENT_QUEUE_URL", value: stateQueue.queueUrl },
        { name: "OPENAI_TRANSCRIBE_MODEL", value: "gpt-4o-mini-transcribe" },
        { name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", value: "gpt-5-nano" },
        { name: "OPENAI_COMMENT_FALLBACK_MODEL", value: "gpt-5-nano" },
        { name: "GEMINI_TEXT_MODEL", value: "gemini-3.5-flash-lite" },
        { name: "GEMINI_COMMENT_MODEL", value: "gemini-2.5-flash-lite" },
        {
          name: "GEMINI_PAID_DATA_PROCESSING_CONFIRMED",
          value: props.environment === "production" ? "true" : "false",
        },
        { name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", value: "30" },
        { name: "OPENAI_TRANSCRIBE_MAX_WORKERS", value: "4" },
        { name: "FFMPEG_THREADS", value: "2" },
        { name: "CLEAN_CLIP_PRESET", value: "superfast" },
        { name: "CLEAN_CLIP_CRF", value: "20" },
        { name: "EDIT_TIMELINE_CAPTURE_ENABLED", value: "true" },
      ],
      secrets: [
        secret("DATABASE_URL"),
        secret("OPENAI_API_KEY"),
        secret("GEMINI_API_KEY"),
        secret("GEMINI_OPENAI_BASE_URL"),
      ],
    };
    const retryStrategy = {
      attempts: 2,
      evaluateOnExit: [
        { action: "EXIT", onExitCode: "42" },
        { action: "EXIT", onExitCode: "43" },
        { action: "RETRY", onExitCode: "*" },
      ],
    };
    const prepareDefinitionName = `shorts-mvp-prepare-${props.environment}`;
    const renderDefinitionName = `shorts-mvp-render-${props.environment}`;
    // Retained for in-flight project resumes created before all new projects moved to 8 vCPU.
    const projectDefinitionName = `shorts-mvp-project-fargate-${props.environment}`;
    const projectHeavyDefinitionName = `shorts-mvp-project-heavy-fargate-${props.environment}`;
    const rerenderDefinitionName = `shorts-mvp-rerender-fargate-${props.environment}`;
    const prepareDefinition = new batch.CfnJobDefinition(this, "PrepareJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: prepareDefinitionName,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 3600 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${prepareWorkerImageTag}`,
        environment: [
          ...baseContainer.environment,
          { name: "TASK_VCPUS", value: "4" },
          { name: "WORKER_IMAGE_TAG", value: prepareWorkerImageTag },
          { name: "INGESTION_EGRESS_MODE", value: "webshare_isp" },
          { name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", value: "30" },
        ],
        secrets: [
          ...baseContainer.secrets,
          secret("INGESTION_PROXY_ROUTES_JSON"),
        ],
        runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
        ephemeralStorage: { sizeInGiB: 30 },
        resourceRequirements: [
          { type: "VCPU", value: "4" },
          { type: "MEMORY", value: "8192" },
        ],
      },
    });
    const renderDefinition = new batch.CfnJobDefinition(this, "RenderJobDefinition", {
      type: "container",
      platformCapabilities: ["EC2"],
      jobDefinitionName: renderDefinitionName,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 1200 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${workerImageTag}`,
        networkConfiguration: undefined,
        resourceRequirements: [
          { type: "VCPU", value: "2" },
          { type: "MEMORY", value: "8192" },
        ],
      },
    });
    const projectDefinition = new batch.CfnJobDefinition(this, "ProjectFargateJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: projectDefinitionName,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 7200 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${workerImageTag}`,
        environment: [
          ...baseContainer.environment,
          { name: "TASK_VCPUS", value: "4" },
          { name: "PROJECT_RESOURCE_TIER", value: "standard" },
          { name: "WORKER_IMAGE_TAG", value: workerImageTag },
          { name: "INGESTION_EGRESS_MODE", value: "webshare_isp" },
          { name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", value: "30" },
        ],
        secrets: [...baseContainer.secrets, secret("INGESTION_PROXY_ROUTES_JSON")],
        runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
        ephemeralStorage: { sizeInGiB: 30 },
        resourceRequirements: [
          { type: "VCPU", value: "4" },
          { type: "MEMORY", value: "30720" },
        ],
      },
    });
    const projectHeavyDefinition = new batch.CfnJobDefinition(
      this,
      "ProjectHeavyFargateJobDefinition",
      {
        type: "container",
        platformCapabilities: ["FARGATE"],
        jobDefinitionName: projectHeavyDefinitionName,
        retryStrategy: { attempts: 1 },
        timeout: { attemptDurationSeconds: 7200 },
        containerProperties: {
          ...baseContainer,
          image: `${repository.repositoryUri}:${workerImageTag}`,
          environment: [
            ...baseContainer.environment,
            { name: "TASK_VCPUS", value: "8" },
            { name: "PROJECT_RESOURCE_TIER", value: "heavy" },
            { name: "WORKER_IMAGE_TAG", value: workerImageTag },
            { name: "INGESTION_EGRESS_MODE", value: "webshare_isp" },
            { name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", value: "30" },
          ],
          secrets: [...baseContainer.secrets, secret("INGESTION_PROXY_ROUTES_JSON")],
          runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
          ephemeralStorage: { sizeInGiB: 30 },
          resourceRequirements: [
            { type: "VCPU", value: "8" },
            { type: "MEMORY", value: "16384" },
          ],
        },
      },
    );
    const rerenderDefinition = new batch.CfnJobDefinition(this, "RerenderFargateJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: rerenderDefinitionName,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 1200 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${legacyRerenderImageTag}`,
        environment: [
          ...baseContainer.environment,
          { name: "TASK_VCPUS", value: "2" },
          { name: "WORKER_IMAGE_TAG", value: legacyRerenderImageTag },
        ],
        runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
        resourceRequirements: [
          { type: "VCPU", value: "2" },
          { type: "MEMORY", value: "16384" },
        ],
      },
    });
    const shortDefinition = new batch.CfnJobDefinition(this, "ShortJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: `shorts-mvp-short-${props.environment}`,
      retryStrategy,
      timeout: { attemptDurationSeconds: 5400 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${workerImageTag}`,
        runtimePlatform: {
          cpuArchitecture: "X86_64",
          operatingSystemFamily: "LINUX",
        },
        resourceRequirements: [
          { type: "VCPU", value: "2" },
          { type: "MEMORY", value: "4096" },
        ],
      },
    });
    const longDefinition = new batch.CfnJobDefinition(this, "LongJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: `shorts-mvp-long-${props.environment}`,
      retryStrategy,
      timeout: { attemptDurationSeconds: 5400 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${workerImageTag}`,
        runtimePlatform: {
          cpuArchitecture: "X86_64",
          operatingSystemFamily: "LINUX",
        },
        ephemeralStorage: { sizeInGiB: 30 },
        resourceRequirements: [
          { type: "VCPU", value: "4" },
          { type: "MEMORY", value: "8192" },
        ],
      },
    });

    const lambdaRole = new iam.Role(this, "MaintenanceLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    runtimeSecret.grantRead(lambdaRole);
    bucket.grantReadWrite(lambdaRole);
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "batch:DescribeJobs",
        "batch:ListJobs", "batch:SubmitJob",
        "batch:TerminateJob", "batch:CancelJob",
      ],
      resources: ["*"],
    }));
    workQueue.grantConsumeMessages(lambdaRole);
    workQueue.grantSendMessages(lambdaRole);
    stateQueue.grantConsumeMessages(lambdaRole);
    const lambdaEnvironment = {
      RUNTIME_SECRET_ARN: runtimeSecret.secretArn,
      MEDIA_BUCKET: bucket.bucketName,
      AWS_BATCH_JOB_QUEUE: queue.ref,
      WORK_DISPATCH_QUEUE_URL: workQueue.queueUrl,
      PREPARE_BATCH_QUEUE: queue.ref,
      PREPARE_JOB_DEFINITION: prepareDefinitionName,
      RENDER_BATCH_QUEUE: renderQueue.ref,
      RENDER_JOB_DEFINITION: renderDefinitionName,
      PROJECT_BATCH_QUEUE: projectQueue.ref,
      PROJECT_JOB_DEFINITION: projectDefinitionName,
      PROJECT_HEAVY_JOB_DEFINITION: projectHeavyDefinitionName,
      RERENDER_JOB_DEFINITION: rerenderDefinitionName,
      STATE_EVENT_QUEUE_URL: stateQueue.queueUrl,
    };
    const lambdaCode = lambda.Code.fromAsset(path.join(__dirname, "../lambda"), {
      exclude: ["__pycache__", "*.pyc"],
    });
    const cleanupLogGroup = new logs.LogGroup(this, "CleanupLogs", {
      logGroupName: `/shorts-mvp/${props.environment}/cleanup`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const batchStateLogGroup = new logs.LogGroup(this, "BatchStateLogs", {
      logGroupName: `/shorts-mvp/${props.environment}/batch-state`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const renderMetricNamespace = `ShortsMvp/${props.environment}`;
    new logs.MetricFilter(this, "RenderShortSucceededMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_short_succeeded" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderShortSucceeded",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "RenderShortDurationMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_short_succeeded" && $.elapsed_seconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderShortDurationSeconds",
      metricValue: "$.elapsed_seconds",
    });
    new logs.MetricFilter(this, "RenderQueueDelayMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_shard_started" && $.queue_delay_seconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderQueueDelaySeconds",
      metricValue: "$.queue_delay_seconds",
    });
    new logs.MetricFilter(this, "RenderPeakMemoryMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_short_succeeded" && $.container_peak_memory_bytes = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderPeakMemoryBytes",
      metricValue: "$.container_peak_memory_bytes",
    });
    new logs.MetricFilter(this, "RenderBatchFailureMetric", {
      logGroup: batchStateLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_batch_failure_handled" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderBatchFailure",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "RenderBatchOomMetric", {
      logGroup: batchStateLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "render_batch_failure_handled" && $.failureCategory = "oom" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderBatchOom",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectDurationMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_finalized" && $.elapsed_seconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectDurationSeconds",
      metricValue: "$.elapsed_seconds",
    });
    new logs.MetricFilter(this, "ProjectPeakMemoryMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_finalized" && $.container_peak_memory_bytes = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectPeakMemoryBytes",
      metricValue: "$.container_peak_memory_bytes",
    });
    new logs.MetricFilter(this, "ProjectOutputFailureMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_output_failed" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectOutputFailure",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectSuccessPercentMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_finalized" && $.result.success_percent = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectSuccessPercent",
      metricValue: "$.result.success_percent",
    });
    new logs.MetricFilter(this, "ProjectQueueDelayMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_started" && $.queue_delay_seconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectQueueDelaySeconds",
      metricValue: "$.queue_delay_seconds",
    });
    new logs.MetricFilter(this, "ProjectResumeMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_started" && $.resume = true }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectResume",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectStandardStartedMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_started" && $.resource_tier = "standard" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectStandardStarted",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectHeavyStartedMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_run_started" && $.resource_tier = "heavy" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectHeavyStarted",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectBatchOomMetric", {
      logGroup: batchStateLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_batch_failure_handled" && $.failureCategory = "oom" }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectBatchOom",
      metricValue: "1",
    });
    new logs.MetricFilter(this, "ProjectExtractionWallMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_extraction_observed" && $.wallSeconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectExtractionWallSeconds",
      metricValue: "$.wallSeconds",
    });
    new logs.MetricFilter(this, "ProjectRenderWallMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.wallSeconds = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "ProjectRenderWallSeconds",
      metricValue: "$.wallSeconds",
    });
    new logs.MetricFilter(this, "RenderComputeFactorMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.renderComputeFactor = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderComputeFactor",
      metricValue: "$.renderComputeFactor",
    });
    new logs.MetricFilter(this, "RenderFfmpegShareMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.renderFfmpegShare = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderFfmpegShare",
      metricValue: "$.renderFfmpegShare",
    });
    new logs.MetricFilter(this, "RenderPhaseCpuUtilizationMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.cpuUtilizationPercent = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "RenderPhaseCpuUtilization",
      metricValue: "$.cpuUtilizationPercent",
    });
    new logs.MetricFilter(this, "LocalCleanReuseMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.localCleanReuseCount = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "LocalCleanReuseCount",
      metricValue: "$.localCleanReuseCount",
    });
    new logs.MetricFilter(this, "S3CleanDownloadMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "project_render_observed" && $.s3CleanDownloadCount = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "S3CleanDownloadCount",
      metricValue: "$.s3CleanDownloadCount",
    });
    new logs.MetricFilter(this, "CleanClipBytesPerSecondMetric", {
      logGroup: workerLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.event = "clean_clip_succeeded" && $.clean_clip_bytes_per_second = * }',
      ),
      metricNamespace: renderMetricNamespace,
      metricName: "CleanClipBytesPerSecond",
      metricValue: "$.clean_clip_bytes_per_second",
    });
    const cleanup = new lambda.Function(this, "CleanupFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "cleanup.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: lambdaEnvironment,
      logGroup: cleanupLogGroup,
    });
    const batchState = new lambda.Function(this, "BatchStateFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "batch_state.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: lambdaEnvironment,
      logGroup: batchStateLogGroup,
    });
    const outboxDispatcher = new lambda.Function(this, "OutboxDispatcherFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "outbox_dispatcher.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: lambdaEnvironment,
    });
    const batchSubmitterFunctionName = `shorts-mvp-batch-submitter-${props.environment}`;
    const legacyProjectJobDefinitionArn = String(
      this.node.tryGetContext("legacyProjectJobDefinitionArn") || "",
    ).trim();
    const legacyProjectBatchQueueArn = String(
      this.node.tryGetContext("legacyProjectBatchQueueArn") || "",
    ).trim();
    const sourceRangeJobDefinitionArn = String(
      this.node.tryGetContext("sourceRangeJobDefinitionArn") || "",
    ).trim();
    const sourceRangeBatchQueueArn = String(
      this.node.tryGetContext("sourceRangeBatchQueueArn") || "",
    ).trim();
    const elevenLabsJobDefinitionArn = String(
      this.node.tryGetContext("elevenLabsTranscriptionJobDefinitionArn") || "",
    ).trim();
    const elevenLabsBatchQueueArn = String(
      this.node.tryGetContext("elevenLabsTranscriptionBatchQueueArn") || "",
    ).trim();
    if (Boolean(elevenLabsJobDefinitionArn) !== Boolean(elevenLabsBatchQueueArn)) {
      throw new Error(
        "ElevenLabs transcription Job Definition and queue ARNs must be configured together",
      );
    }
    const subtitleTemplatesJobDefinitionArn = String(
      this.node.tryGetContext("subtitleTemplatesJobDefinitionArn") || "",
    ).trim();
    const subtitleTemplatesBatchQueueArn = String(
      this.node.tryGetContext("subtitleTemplatesBatchQueueArn") || "",
    ).trim();
    if (
      Boolean(subtitleTemplatesJobDefinitionArn)
      !== Boolean(subtitleTemplatesBatchQueueArn)
    ) {
      throw new Error(
        "Subtitle template Job Definition and queue ARNs must be configured together",
      );
    }
    if (
      subtitleTemplatesJobDefinitionArn
      && subtitleTemplatesJobDefinitionArn === elevenLabsJobDefinitionArn
    ) {
      throw new Error(
        "Subtitle template target must use a new immutable Job Definition",
      );
    }
    const unifiedTemplateSubtitlesJobDefinitionArn = String(
      this.node.tryGetContext("unifiedTemplateSubtitlesJobDefinitionArn") || "",
    ).trim();
    const unifiedTemplateSubtitlesBatchQueueArn = String(
      this.node.tryGetContext("unifiedTemplateSubtitlesBatchQueueArn") || "",
    ).trim();
    const unifiedTemplateSubtitlesPreviousJobDefinitionArn = String(
      this.node.tryGetContext(
        "unifiedTemplateSubtitlesPreviousJobDefinitionArn",
      ) || "",
    ).trim();
    if (
      Boolean(unifiedTemplateSubtitlesJobDefinitionArn)
      !== Boolean(unifiedTemplateSubtitlesBatchQueueArn)
    ) {
      throw new Error(
        "Unified template subtitle Job Definition and queue ARNs must be configured together",
      );
    }
    if (
      unifiedTemplateSubtitlesJobDefinitionArn
      && !pinnedBatchJobDefinitionArn.test(
        unifiedTemplateSubtitlesJobDefinitionArn,
      )
    ) {
      throw new Error(
        "Unified template subtitle Job Definition must be an exact revision-pinned ARN",
      );
    }
    if (
      unifiedTemplateSubtitlesBatchQueueArn
      && !pinnedBatchQueueArn.test(unifiedTemplateSubtitlesBatchQueueArn)
    ) {
      throw new Error(
        "Unified template subtitle queue must be an exact ARN",
      );
    }
    if (
      unifiedTemplateSubtitlesPreviousJobDefinitionArn
      && !unifiedTemplateSubtitlesJobDefinitionArn
    ) {
      throw new Error(
        "Previous unified template subtitle Job Definition requires the primary target",
      );
    }
    if (
      unifiedTemplateSubtitlesPreviousJobDefinitionArn
      && !pinnedBatchJobDefinitionArn.test(
        unifiedTemplateSubtitlesPreviousJobDefinitionArn,
      )
    ) {
      throw new Error(
        "Previous unified template subtitle Job Definition must be an exact revision-pinned ARN",
      );
    }
    if (
      unifiedTemplateSubtitlesPreviousJobDefinitionArn
      && unifiedTemplateSubtitlesPreviousJobDefinitionArn
        === unifiedTemplateSubtitlesJobDefinitionArn
    ) {
      throw new Error(
        "Previous unified template subtitle Job Definition must differ from the primary target",
      );
    }
    if (
      unifiedTemplateSubtitlesJobDefinitionArn
      && new Set([
        legacyProjectJobDefinitionArn,
        sourceRangeJobDefinitionArn,
        elevenLabsJobDefinitionArn,
        subtitleTemplatesJobDefinitionArn,
      ]).has(unifiedTemplateSubtitlesJobDefinitionArn)
    ) {
      throw new Error(
        "Unified template subtitle target must use a separate immutable Job Definition",
      );
    }
    if (
      unifiedTemplateSubtitlesPreviousJobDefinitionArn
      && new Set([
        legacyProjectJobDefinitionArn,
        sourceRangeJobDefinitionArn,
        elevenLabsJobDefinitionArn,
        subtitleTemplatesJobDefinitionArn,
        unifiedTemplateSubtitlesJobDefinitionArn,
      ]).has(unifiedTemplateSubtitlesPreviousJobDefinitionArn)
    ) {
      throw new Error(
        "Previous unified template subtitle target must use a separate immutable Job Definition",
      );
    }
    if (props.environment === "production") {
      const requiredProductionTargets = {
        legacyProjectJobDefinitionArn,
        legacyProjectBatchQueueArn,
        sourceRangeJobDefinitionArn,
        sourceRangeBatchQueueArn,
        elevenLabsJobDefinitionArn,
        elevenLabsBatchQueueArn,
        subtitleTemplatesJobDefinitionArn,
        subtitleTemplatesBatchQueueArn,
        unifiedTemplateSubtitlesJobDefinitionArn,
        unifiedTemplateSubtitlesBatchQueueArn,
      };
      const missingTargets = Object.entries(requiredProductionTargets)
        .filter(([, value]) => !value)
        .map(([name]) => name);
      if (missingTargets.length > 0) {
        throw new Error(
          `Production Batch targets must be explicitly pinned: ${missingTargets.join(", ")}`,
        );
      }
    }
    const batchSubmitter = new lambda.Function(this, "BatchSubmitterFunction", {
      functionName: batchSubmitterFunctionName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "batch_submitter.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      environment: {
        ...lambdaEnvironment,
        LEGACY_PROJECT_JOB_DEFINITION_ARN:
          legacyProjectJobDefinitionArn || projectHeavyDefinition.ref,
        LEGACY_PROJECT_BATCH_QUEUE_ARN:
          legacyProjectBatchQueueArn || projectQueue.ref,
        SOURCE_RANGE_JOB_DEFINITION_ARN:
          sourceRangeJobDefinitionArn || legacyProjectJobDefinitionArn || projectHeavyDefinition.ref,
        SOURCE_RANGE_BATCH_QUEUE_ARN:
          sourceRangeBatchQueueArn || legacyProjectBatchQueueArn || projectQueue.ref,
        ...(elevenLabsJobDefinitionArn ? {
          ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN:
            elevenLabsJobDefinitionArn,
          ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN:
            elevenLabsBatchQueueArn,
        } : {}),
        ...(subtitleTemplatesJobDefinitionArn ? {
          SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
            subtitleTemplatesJobDefinitionArn,
          SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN:
            subtitleTemplatesBatchQueueArn,
        } : {}),
        ...(unifiedTemplateSubtitlesJobDefinitionArn ? {
          UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN:
            unifiedTemplateSubtitlesJobDefinitionArn,
          UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN:
            unifiedTemplateSubtitlesBatchQueueArn,
        } : {}),
        ...(unifiedTemplateSubtitlesPreviousJobDefinitionArn ? {
          UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN:
            unifiedTemplateSubtitlesPreviousJobDefinitionArn,
        } : {}),
      },
    });
    outboxDispatcher.addEnvironment(
      "BATCH_SUBMITTER_FUNCTION_NAME",
      batchSubmitterFunctionName,
    );
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [this.formatArn({
        service: "lambda",
        resource: "function",
        resourceName: batchSubmitterFunctionName,
        arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
      })],
    }));
    batchSubmitter.addEventSource(new lambdaEventSources.SqsEventSource(workQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    const stateWriter = new lambda.Function(this, "StateWriterFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "state_writer.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: lambdaEnvironment,
    });
    stateWriter.addEventSource(new lambdaEventSources.SqsEventSource(stateQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(1),
      reportBatchItemFailures: true,
    }));
    new events.Rule(this, "MinuteCleanup", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(cleanup)],
    });
    new events.Rule(this, "MinuteOutboxDispatch", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(outboxDispatcher)],
    });
    new events.Rule(this, "BatchStateEvents", {
      eventPattern: {
        source: ["aws.batch"],
        detailType: ["Batch Job State Change"],
        detail: { status: ["SUCCEEDED", "FAILED"] },
      },
      targets: [new targets.LambdaFunction(batchState)],
    });

    const team = this.node.tryGetContext("vercelTeamSlug")
      || process.env.VERCEL_TEAM_SLUG || "replace-me";
    const project = this.node.tryGetContext("vercelProjectName")
      || process.env.VERCEL_PROJECT_NAME || "replace-me";
    const issuer = `https://oidc.vercel.com/${team}`;
    const defaultAudience = `https://vercel.com/${team}`;
    const awsAudience = "sts.amazonaws.com";
    const vercelProviderArn = this.node.tryGetContext("vercelOidcProviderArn");
    const provider = vercelProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "ImportedVercelOidcProvider",
          vercelProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "VercelOidcProvider", {
          url: issuer,
          clientIds: [defaultAudience, awsAudience],
        });
    const vercelRole = new iam.Role(this, "VercelControlPlaneRole", {
      assumedBy: new iam.OpenIdConnectPrincipal(provider).withConditions({
        StringEquals: {
          [`${issuer.replace("https://", "")}:aud`]: awsAudience,
          [`${issuer.replace("https://", "")}:sub`]:
            `owner:${team}:project:${project}:environment:production`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    bucket.grantDelete(vercelRole, "outputs/*");
    bucket.grantDelete(vercelRole, "thumbnails/*");
    bucket.grantDelete(vercelRole, "edit-sources/*");
    bucket.grantWrite(vercelRole, "edit-sources/*");
    bucket.grantRead(vercelRole, "outputs/*");
    outboxDispatcher.grantInvoke(vercelRole);

    const githubOrg = this.node.tryGetContext("githubOrg") || "dongk176";
    const githubRepo = this.node.tryGetContext("githubRepo") || "shorts";
    const githubProviderArn = this.node.tryGetContext("githubOidcProviderArn");
    const githubProvider = githubProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "ImportedGithubOidcProvider",
          githubProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });
    const githubRole = new iam.Role(this, "GithubWorkerBuildRole", {
      assumedBy: new iam.OpenIdConnectPrincipal(githubProvider).withConditions({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub":
            `repo:${githubOrg}/${githubRepo}:ref:refs/heads/main`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    repository.grantPullPush(githubRole);
    githubRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));

    new cdk.CfnOutput(this, "BatchJobQueue", { value: queue.ref });
    new cdk.CfnOutput(this, "BatchJobDefinitionShort", { value: shortDefinition.ref });
    new cdk.CfnOutput(this, "BatchJobDefinitionLong", { value: longDefinition.ref });
    new cdk.CfnOutput(this, "PrepareBatchJobQueue", { value: queue.ref });
    new cdk.CfnOutput(this, "PrepareBatchJobDefinition", { value: prepareDefinition.ref });
    new cdk.CfnOutput(this, "RenderBatchJobQueue", { value: renderQueue.ref });
    new cdk.CfnOutput(this, "RenderBatchJobDefinition", { value: renderDefinition.ref });
    new cdk.CfnOutput(this, "ProjectFargateBatchJobQueue", { value: projectQueue.ref });
    new cdk.CfnOutput(this, "ProjectFargateBatchJobDefinition", {
      value: projectDefinition.ref,
    });
    new cdk.CfnOutput(this, "RerenderFargateBatchJobDefinition", {
      value: rerenderDefinition.ref,
    });
    new cdk.CfnOutput(this, "WorkDispatchQueueUrl", { value: workQueue.queueUrl });
    new cdk.CfnOutput(this, "StateEventQueueUrl", { value: stateQueue.queueUrl });
    new cdk.CfnOutput(this, "OutboxDispatcherFunctionArn", {
      value: outboxDispatcher.functionArn,
    });
    new cdk.CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
    new cdk.CfnOutput(this, "WorkerTaskRoleArn", { value: taskRole.roleArn });
    new cdk.CfnOutput(this, "GithubWorkerBuildRoleArn", { value: githubRole.roleArn });
  }
}

/**
 * Isolated source-range capacity. This stack imports the exact running worker
 * resources through deployment-time context so deploying it cannot revise the
 * existing production Job Definitions or queues.
 */
export class ShortsMvpSourceRangeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BaseProps) {
    super(scope, id, props);
    const subnetIds = requiredContext(this, "sourceRangeSubnetIds")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (subnetIds.length < 2 || subnetIds.some((value) => !/^subnet-[0-9a-f]+$/.test(value))) {
      throw new Error("sourceRangeSubnetIds must contain at least two subnet IDs");
    }
    const securityGroupId = requiredContext(this, "sourceRangeSecurityGroupId");
    const executionRoleArn = requiredContext(this, "sourceRangeExecutionRoleArn");
    const taskRoleArn = requiredContext(this, "sourceRangeTaskRoleArn");
    const logGroupName = requiredContext(this, "sourceRangeLogGroupName");
    const runtimeSecretArn = requiredContext(this, "sourceRangeRuntimeSecretArn");
    const mediaBucketName = requiredContext(this, "sourceRangeMediaBucketName");
    const workQueueUrl = requiredContext(this, "sourceRangeWorkQueueUrl");
    const stateQueueUrl = requiredContext(this, "sourceRangeStateQueueUrl");
    const repositoryUri = requiredContext(this, "sourceRangeRepositoryUri");
    const imageDigest = requiredContext(this, "sourceRangeImageDigest");
    if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
      throw new Error("sourceRangeImageDigest must be an immutable sha256 digest");
    }
    const maxVcpus = Number(this.node.tryGetContext("sourceRangeMaxVcpus") || 160);
    if (!Number.isInteger(maxVcpus) || maxVcpus < 8 || maxVcpus > 160) {
      throw new Error("sourceRangeMaxVcpus must be an integer from 8 to 160");
    }

    const compute = new batch.CfnComputeEnvironment(this, "SourceRangeCompute", {
      computeEnvironmentName: `shorts-mvp-source-range-fargate-${props.environment}`,
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        type: "FARGATE",
        maxvCpus: maxVcpus,
        subnets: subnetIds,
        securityGroupIds: [securityGroupId],
      },
    });
    const schedulingPolicy = new batch.CfnSchedulingPolicy(
      this,
      "SourceRangeFairSharePolicy",
      {
        name: `shorts-mvp-source-range-fair-share-${props.environment}`,
        fairsharePolicy: {
          computeReservation: 10,
          shareDecaySeconds: 600,
          shareDistribution: [
            { shareIdentifier: "paid*", weightFactor: 0.25 },
            { shareIdentifier: "free*", weightFactor: 1 },
          ],
        },
      },
    );
    const queue = new batch.CfnJobQueue(this, "SourceRangeQueue", {
      jobQueueName: `shorts-mvp-source-range-${props.environment}`,
      priority: 20,
      state: "ENABLED",
      schedulingPolicyArn: schedulingPolicy.attrArn,
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
    });
    const secret = (name: string) => ({
      name,
      valueFrom: `${runtimeSecretArn}:${name}::`,
    });
    const definition = new batch.CfnJobDefinition(this, "SourceRangeJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: `shorts-mvp-source-range-v1-${props.environment}`,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 18000 },
      containerProperties: {
        image: `${repositoryUri}@${imageDigest}`,
        executionRoleArn,
        jobRoleArn: taskRoleArn,
        networkConfiguration: { assignPublicIp: "ENABLED" },
        linuxParameters: { initProcessEnabled: true },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroupName,
            "awslogs-region": this.region,
            "awslogs-stream-prefix": "source-range",
          },
        },
        environment: [
          { name: "AWS_REGION", value: this.region },
          { name: "AWS_DEFAULT_REGION", value: this.region },
          { name: "AWS_S3_OUTPUT_BUCKET", value: mediaBucketName },
          { name: "TEMP_ROOT", value: "/tmp/shorts-jobs" },
          { name: "WORK_DISPATCH_QUEUE_URL", value: workQueueUrl },
          { name: "STATE_EVENT_QUEUE_URL", value: stateQueueUrl },
          { name: "OPENAI_TRANSCRIBE_MODEL", value: "gpt-4o-mini-transcribe" },
          { name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", value: "gpt-5-nano" },
          { name: "OPENAI_COMMENT_FALLBACK_MODEL", value: "gpt-5-nano" },
          { name: "GEMINI_TEXT_MODEL", value: "gemini-3.5-flash-lite" },
          { name: "GEMINI_COMMENT_MODEL", value: "gemini-2.5-flash-lite" },
          { name: "GEMINI_PAID_DATA_PROCESSING_CONFIRMED", value: "true" },
          { name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", value: "30" },
          { name: "OPENAI_TRANSCRIBE_MAX_WORKERS", value: "4" },
          { name: "FFMPEG_THREADS", value: "2" },
          { name: "CLEAN_CLIP_PRESET", value: "superfast" },
          { name: "CLEAN_CLIP_CRF", value: "20" },
          { name: "EDIT_TIMELINE_CAPTURE_ENABLED", value: "true" },
          { name: "TASK_VCPUS", value: "8" },
          { name: "PROJECT_RESOURCE_TIER", value: "source_range" },
          { name: "MAX_VIDEO_DURATION_SECONDS", value: "14400" },
          { name: "DOWNLOAD_TIMEOUT_SECONDS", value: "14400" },
          { name: "WORKER_IMAGE_TAG", value: imageDigest },
          { name: "INGESTION_EGRESS_MODE", value: "webshare_isp" },
          { name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", value: "30" },
        ],
        secrets: [
          secret("DATABASE_URL"),
          secret("OPENAI_API_KEY"),
          secret("GEMINI_API_KEY"),
          secret("GEMINI_OPENAI_BASE_URL"),
          secret("INGESTION_PROXY_ROUTES_JSON"),
        ],
        runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
        ephemeralStorage: { sizeInGiB: 80 },
        resourceRequirements: [
          { type: "VCPU", value: "8" },
          { type: "MEMORY", value: "16384" },
        ],
      },
    });

    const metricNamespace = `ShortsMvp/${props.environment}`;
    const metric = (id: string, eventPattern: string, metricName: string) => {
      new logs.CfnMetricFilter(this, id, {
        logGroupName,
        filterPattern: eventPattern,
        metricTransformations: [{
          metricNamespace,
          metricName,
          metricValue: "1",
        }],
      });
    };
    metric(
      "SourceRangeSucceededMetric",
      '{ $.event = "project_run_finalized" && $.resource_tier = "source_range" }',
      "SourceRangeProjectSucceeded",
    );
    metric(
      "SourceRangeFailedMetric",
      '{ $.event = "project_run_failed" && $.resource_tier = "source_range" }',
      "SourceRangeProjectFailed",
    );
    metric(
      "SourceRangeFullSourceMetric",
      '{ $.event = "source_download_observed" && $.source_range_enabled = true && $.status = "full_source_expected" }',
      "SourceRangeFullSourceExpected",
    );
    metric(
      "SourceRangeSourceValidationMetric",
      '{ $.event = "project_run_failed" && $.resource_tier = "source_range" && $.error_code = "ingestion_source_validation_failed" }',
      "SourceRangeSourceValidationFailed",
    );

    new cdk.CfnOutput(this, "SourceRangeBatchJobQueueArn", { value: queue.ref });
    new cdk.CfnOutput(this, "SourceRangeBatchJobDefinitionArn", {
      value: definition.ref,
    });
    new cdk.CfnOutput(this, "SourceRangeComputeEnvironmentArn", {
      value: compute.ref,
    });
  }
}

/**
 * Isolated ElevenLabs transcription canary. It imports the currently running
 * worker roles, queues and storage but owns its compute, queue and immutable
 * Job Definition, so enabling the canary cannot replace stable capacity.
 */
export class ShortsMvpElevenLabsTranscriptionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BaseProps) {
    super(scope, id, props);
    const subnetIds = requiredContext(this, "sourceRangeSubnetIds")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (subnetIds.length < 2 || subnetIds.some((value) => !/^subnet-[0-9a-f]+$/.test(value))) {
      throw new Error("sourceRangeSubnetIds must contain at least two subnet IDs");
    }
    const securityGroupId = requiredContext(this, "sourceRangeSecurityGroupId");
    const executionRoleArn = requiredContext(this, "sourceRangeExecutionRoleArn");
    const taskRoleArn = requiredContext(this, "sourceRangeTaskRoleArn");
    const logGroupName = requiredContext(this, "sourceRangeLogGroupName");
    const runtimeSecretArn = requiredContext(this, "sourceRangeRuntimeSecretArn");
    const mediaBucketName = requiredContext(this, "sourceRangeMediaBucketName");
    const workQueueUrl = requiredContext(this, "sourceRangeWorkQueueUrl");
    const stateQueueUrl = requiredContext(this, "sourceRangeStateQueueUrl");
    const repositoryUri = requiredContext(this, "sourceRangeRepositoryUri");
    const imageDigest = requiredContext(this, "elevenLabsTranscriptionImageDigest");
    if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
      throw new Error("elevenLabsTranscriptionImageDigest must be an immutable sha256 digest");
    }
    const maxVcpus = Number(
      this.node.tryGetContext("elevenLabsTranscriptionMaxVcpus") || 32,
    );
    if (!Number.isInteger(maxVcpus) || maxVcpus < 8 || maxVcpus > 160) {
      throw new Error(
        "elevenLabsTranscriptionMaxVcpus must be an integer from 8 to 160",
      );
    }

    const compute = new batch.CfnComputeEnvironment(this, "Compute", {
      computeEnvironmentName:
        `shorts-mvp-elevenlabs-transcription-fargate-${props.environment}`,
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        type: "FARGATE",
        maxvCpus: maxVcpus,
        subnets: subnetIds,
        securityGroupIds: [securityGroupId],
      },
    });
    const schedulingPolicyArn = requiredContext(
      this,
      "sourceRangeSchedulingPolicyArn",
    );
    const queue = new batch.CfnJobQueue(this, "Queue", {
      jobQueueName:
        `shorts-mvp-elevenlabs-transcription-canary-${props.environment}`,
      priority: 30,
      state: "ENABLED",
      schedulingPolicyArn,
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
    });
    const secret = (name: string) => ({
      name,
      valueFrom: `${runtimeSecretArn}:${name}::`,
    });
    const definition = new batch.CfnJobDefinition(this, "JobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName:
        `shorts-mvp-elevenlabs-transcription-canary-${props.environment}`,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 18000 },
      containerProperties: {
        image: `${repositoryUri}@${imageDigest}`,
        executionRoleArn,
        jobRoleArn: taskRoleArn,
        networkConfiguration: { assignPublicIp: "ENABLED" },
        linuxParameters: { initProcessEnabled: true },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroupName,
            "awslogs-region": this.region,
            "awslogs-stream-prefix": "elevenlabs-transcription-canary",
          },
        },
        environment: [
          { name: "AWS_REGION", value: this.region },
          { name: "AWS_DEFAULT_REGION", value: this.region },
          { name: "AWS_S3_OUTPUT_BUCKET", value: mediaBucketName },
          { name: "TEMP_ROOT", value: "/tmp/shorts-jobs" },
          { name: "WORK_DISPATCH_QUEUE_URL", value: workQueueUrl },
          { name: "STATE_EVENT_QUEUE_URL", value: stateQueueUrl },
          { name: "ELEVENLABS_TRANSCRIBE_MODEL", value: "scribe_v2" },
          { name: "OPENAI_TRANSCRIBE_MODEL", value: "gpt-4o-mini-transcribe" },
          { name: "OPENAI_TRANSCRIBE_FALLBACK_MODEL", value: "whisper-1" },
          { name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", value: "gpt-5-nano" },
          { name: "OPENAI_COMMENT_FALLBACK_MODEL", value: "gpt-5-nano" },
          { name: "GEMINI_TEXT_MODEL", value: "gemini-3.5-flash-lite" },
          { name: "GEMINI_COMMENT_MODEL", value: "gemini-2.5-flash-lite" },
          { name: "GEMINI_PAID_DATA_PROCESSING_CONFIRMED", value: "true" },
          { name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", value: "30" },
          { name: "OPENAI_TRANSCRIBE_MAX_WORKERS", value: "4" },
          { name: "FFMPEG_THREADS", value: "2" },
          { name: "CLEAN_CLIP_PRESET", value: "superfast" },
          { name: "CLEAN_CLIP_CRF", value: "20" },
          { name: "EDIT_TIMELINE_CAPTURE_ENABLED", value: "true" },
          { name: "TASK_VCPUS", value: "8" },
          { name: "PROJECT_RESOURCE_TIER", value: "elevenlabs_transcription" },
          { name: "MAX_VIDEO_DURATION_SECONDS", value: "14400" },
          { name: "DOWNLOAD_TIMEOUT_SECONDS", value: "14400" },
          { name: "WORKER_IMAGE_TAG", value: imageDigest },
          { name: "INGESTION_EGRESS_MODE", value: "webshare_isp" },
          { name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", value: "30" },
        ],
        secrets: [
          secret("DATABASE_URL"),
          secret("ELEVENLABS_API_KEY"),
          secret("OPENAI_API_KEY"),
          secret("GEMINI_API_KEY"),
          secret("GEMINI_OPENAI_BASE_URL"),
          secret("INGESTION_PROXY_ROUTES_JSON"),
        ],
        runtimePlatform: {
          cpuArchitecture: "X86_64",
          operatingSystemFamily: "LINUX",
        },
        ephemeralStorage: { sizeInGiB: 80 },
        resourceRequirements: [
          { type: "VCPU", value: "8" },
          { type: "MEMORY", value: "16384" },
        ],
      },
    });

    new cdk.CfnOutput(this, "BatchJobQueueArn", { value: queue.ref });
    new cdk.CfnOutput(this, "BatchJobDefinitionArn", { value: definition.ref });
    new cdk.CfnOutput(this, "ComputeEnvironmentArn", { value: compute.ref });
  }
}

export class ShortsMvpEditorTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id, props);
    const { repository, editorReleaseRepository } = props.foundation;
    const workerImageTag = String(
      this.node.tryGetContext("workerImageTag")
        || process.env.WORKER_IMAGE_TAG
        || "",
    );
    if (!workerImageTag || workerImageTag === "latest") {
      throw new Error(
        "workerImageTag must be an immutable published image tag; latest is not allowed",
      );
    }
    const bucket = new s3.Bucket(this, "EditorTestMediaBucket", {
      bucketName: `shorts-mvp-editor-test-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{
        id: "ExpireEditorTestMedia",
        enabled: true,
        expiration: cdk.Duration.days(3),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      }],
    });
    const runtimeSecret = new secretsmanager.Secret(
      this,
      "EditorTestRuntimeSecret",
      {
        secretName: "shorts-mvp/editor-test/worker-runtime",
        description: "Isolated editor render test credentials; never production values",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            DATABASE_URL: "",
            OPENAI_API_KEY: "",
            GEMINI_API_KEY: "",
            GEMINI_OPENAI_BASE_URL:
              "https://generativelanguage.googleapis.com/v1beta/openai/",
          }),
          generateStringKey: "_bootstrap",
          excludePunctuation: true,
        },
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    );
    const vpc = new ec2.Vpc(this, "EditorTestVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "EditorTestWorkers",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }],
    });
    const subnetIds = vpc.selectSubnets({
      subnetGroupName: "EditorTestWorkers",
    }).subnetIds;
    const securityGroup = new ec2.SecurityGroup(
      this,
      "EditorTestWorkerSecurityGroup",
      {
        vpc,
        allowAllOutbound: false,
        description: "No inbound traffic; isolated editor test worker egress",
      },
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS",
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Staging Postgres",
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6543),
      "Staging Postgres pooler",
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(53),
      "VPC DNS UDP",
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(53),
      "VPC DNS TCP",
    );
    const logGroup = new logs.LogGroup(this, "EditorTestWorkerLogs", {
      logGroupName: "/shorts-mvp/editor-test/worker",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const taskRole = new iam.Role(this, "EditorTestWorkerTaskRole", {
      roleName: "shorts-mvp-editor-test-task",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    bucket.grantReadWrite(taskRole);
    runtimeSecret.grantRead(taskRole);
    const executionRole = new iam.Role(this, "EditorTestWorkerExecutionRole", {
      roleName: "shorts-mvp-editor-test-execution",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });
    runtimeSecret.grantRead(executionRole);
    repository.grantPull(executionRole);
    editorReleaseRepository.grantPull(executionRole);
    logGroup.grantWrite(executionRole);
    const compute = new batch.CfnComputeEnvironment(
      this,
      "EditorTestFargateCompute",
      {
        type: "MANAGED",
        state: "ENABLED",
        computeResources: {
          type: "FARGATE",
          maxvCpus: 4,
          subnets: subnetIds,
          securityGroupIds: [securityGroup.securityGroupId],
        },
      },
    );
    const queue = new batch.CfnJobQueue(this, "EditorTestJobQueue", {
      priority: 1,
      state: "ENABLED",
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
      jobQueueName: "shorts-mvp-editor-test",
    });
    const definition = new batch.CfnJobDefinition(
      this,
      "EditorTestTemplateJobDefinition",
      {
        type: "container",
        platformCapabilities: ["FARGATE"],
        jobDefinitionName: "shorts-mvp-editor-test-template",
        retryStrategy: { attempts: 1 },
        timeout: { attemptDurationSeconds: 1200 },
        containerProperties: {
          image: `${repository.repositoryUri}:${workerImageTag}`,
          executionRoleArn: executionRole.roleArn,
          jobRoleArn: taskRole.roleArn,
          networkConfiguration: { assignPublicIp: "ENABLED" },
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup.logGroupName,
              "awslogs-region": this.region,
              "awslogs-stream-prefix": "job",
            },
          },
          environment: [
            { name: "AWS_REGION", value: this.region },
            { name: "AWS_DEFAULT_REGION", value: this.region },
            { name: "AWS_S3_OUTPUT_BUCKET", value: bucket.bucketName },
            { name: "TEMP_ROOT", value: "/tmp/shorts-editor-tests" },
            { name: "TASK_VCPUS", value: "2" },
            { name: "FFMPEG_THREADS", value: "2" },
            {
              name: "GEMINI_PAID_DATA_PROCESSING_CONFIRMED",
              value: "false",
            },
          ],
          secrets: [
            {
              name: "DATABASE_URL",
              valueFrom: `${runtimeSecret.secretArn}:DATABASE_URL::`,
            },
          ],
          runtimePlatform: {
            cpuArchitecture: "X86_64",
            operatingSystemFamily: "LINUX",
          },
          resourceRequirements: [
            { type: "VCPU", value: "2" },
            { type: "MEMORY", value: "16384" },
          ],
        },
      },
    );
    new cdk.CfnOutput(this, "EditorTestMediaBucketName", {
      value: bucket.bucketName,
    });
    new cdk.CfnOutput(this, "EditorTestRuntimeSecretArn", {
      value: runtimeSecret.secretArn,
    });
    new cdk.CfnOutput(this, "EditorTestBatchJobQueue", {
      value: queue.ref,
    });
    new cdk.CfnOutput(this, "EditorTestTemplateJobDefinitionArn", {
      value: definition.ref,
    });
  }
}
