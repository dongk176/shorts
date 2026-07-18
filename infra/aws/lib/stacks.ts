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

const projectRoot = path.resolve(__dirname, "../../..");
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

export class ShortsMvpFoundationStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly repository: ecr.Repository;
  readonly runtimeSecret: secretsmanager.Secret;
  readonly distribution: cloudfront.Distribution;
  readonly keyPairId: string;

  constructor(scope: Construct, id: string, props: BaseProps) {
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
      lifecycleRules: [{ maxImageCount: 16, description: "Keep recent prepare and render images" }],
    });
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
        "function handler(event){var r=event.request;if(!r.uri.startsWith('/outputs/')&&!r.uri.startsWith('/examples/'))return {statusCode:403,statusDescription:'Forbidden'};return r;}"
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
        }],
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      comment: `Private Shorts MVP outputs (${props.environment})`,
    });
    this.keyPairId = publicKey.publicKeyId;

    new cdk.CfnOutput(this, "MediaBucketName", { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, "WorkerRepositoryUri", { value: this.repository.repositoryUri });
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

export class ShortsMvpComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id, props);
    const { bucket, repository, runtimeSecret } = props.foundation;
    const workerImageTag = String(
      this.node.tryGetContext("workerImageTag") || process.env.WORKER_IMAGE_TAG || "",
    );
    if (!workerImageTag || workerImageTag === "latest") {
      throw new Error(
        "workerImageTag must be an immutable published image tag; latest is not allowed",
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
    const renderQueue = new batch.CfnJobQueue(this, "RenderJobQueue", {
      priority: 10,
      state: "ENABLED",
      computeEnvironmentOrder: [
        { order: 1, computeEnvironment: renderSpot.ref },
        { order: 2, computeEnvironment: renderOnDemand.ref },
      ],
      jobQueueName: `shorts-mvp-render-${props.environment}`,
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
        { name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", value: "30" },
        { name: "OPENAI_TRANSCRIBE_MAX_WORKERS", value: "4" },
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
    const prepareDefinition = new batch.CfnJobDefinition(this, "PrepareJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: `shorts-mvp-prepare-${props.environment}`,
      retryStrategy: { attempts: 1 },
      timeout: { attemptDurationSeconds: 3600 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${prepareWorkerImageTag}`,
        environment: [
          ...baseContainer.environment,
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
      jobDefinitionName: `shorts-mvp-render-${props.environment}`,
      retryStrategy: { attempts: 2 },
      timeout: { attemptDurationSeconds: 1200 },
      containerProperties: {
        ...baseContainer,
        image: `${repository.repositoryUri}:${workerImageTag}`,
        networkConfiguration: undefined,
        resourceRequirements: [
          { type: "VCPU", value: "4" },
          { type: "MEMORY", value: "8192" },
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
        "batch:DescribeJobs", "batch:ListJobs", "batch:SubmitJob",
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
      PREPARE_JOB_DEFINITION: prepareDefinition.ref,
      RENDER_BATCH_QUEUE: renderQueue.ref,
      RENDER_JOB_DEFINITION: renderDefinition.ref,
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
      timeout: cdk.Duration.seconds(50),
      memorySize: 256,
      environment: lambdaEnvironment,
    });
    const batchSubmitterFunctionName = `shorts-mvp-batch-submitter-${props.environment}`;
    const batchSubmitter = new lambda.Function(this, "BatchSubmitterFunction", {
      functionName: batchSubmitterFunctionName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "batch_submitter.handler",
      code: lambdaCode,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      environment: lambdaEnvironment,
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
