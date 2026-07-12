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
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
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
        id: "ExpireMvpMedia",
        enabled: true,
        expiration: cdk.Duration.days(30),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      }],
    });
    this.repository = new ecr.Repository(this, "WorkerRepository", {
      repositoryName: `shorts-mvp-worker-${props.environment}`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 8, description: "Keep the latest eight worker images" }],
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
          WARP_CONF_B64: "",
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
        "function handler(event){var r=event.request;if(!r.uri.startsWith('/outputs/'))return {statusCode:403,statusDescription:'Forbidden'};return r;}"
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
    const vpc = new ec2.Vpc(this, "WorkerVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "PublicWorkers",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }],
    });
    const securityGroup = new ec2.SecurityGroup(this, "WorkerSecurityGroup", {
      vpc,
      description: "No inbound traffic; outbound HTTPS for Batch workers",
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS only");
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

    const compute = new batch.CfnComputeEnvironment(this, "FargateCompute", {
      type: "MANAGED",
      state: "ENABLED",
      computeResources: {
        type: "FARGATE",
        maxvCpus: 12,
        subnets: vpc.publicSubnets.map((subnet) => subnet.subnetId),
        securityGroupIds: [securityGroup.securityGroupId],
      },
    });
    const queue = new batch.CfnJobQueue(this, "JobQueue", {
      priority: 10,
      state: "ENABLED",
      computeEnvironmentOrder: [{ order: 1, computeEnvironment: compute.ref }],
      jobQueueName: `shorts-mvp-${props.environment}`,
    });
    const secret = (key: string) => ({
      name: key,
      valueFrom: `${runtimeSecret.secretArn}:${key}::`,
    });
    const baseContainer = {
      image: `${repository.repositoryUri}:latest`,
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
        { name: "AWS_S3_OUTPUT_BUCKET", value: bucket.bucketName },
        { name: "TEMP_ROOT", value: "/tmp/shorts-jobs" },
        { name: "BOT_CHECK_COOLDOWN_SECONDS", value: "1800" },
      ],
      secrets: [
        secret("DATABASE_URL"),
        secret("OPENAI_API_KEY"),
        secret("GEMINI_API_KEY"),
        secret("GEMINI_OPENAI_BASE_URL"),
        secret("WARP_CONF_B64"),
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
    const shortDefinition = new batch.CfnJobDefinition(this, "ShortJobDefinition", {
      type: "container",
      platformCapabilities: ["FARGATE"],
      jobDefinitionName: `shorts-mvp-short-${props.environment}`,
      retryStrategy,
      timeout: { attemptDurationSeconds: 5400 },
      containerProperties: {
        ...baseContainer,
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
      actions: ["batch:DescribeJobs"],
      resources: ["*"],
    }));
    const lambdaEnvironment = {
      RUNTIME_SECRET_ARN: runtimeSecret.secretArn,
      MEDIA_BUCKET: bucket.bucketName,
      AWS_BATCH_JOB_QUEUE: queue.ref,
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
    new events.Rule(this, "HourlyCleanup", {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(cleanup)],
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
    vercelRole.addToPolicy(new iam.PolicyStatement({
      actions: ["batch:SubmitJob"],
      resources: [
        queue.attrJobQueueArn,
        shortDefinition.ref,
        longDefinition.ref,
        `${shortDefinition.ref}:*`,
        `${longDefinition.ref}:*`,
      ],
    }));
    vercelRole.addToPolicy(new iam.PolicyStatement({
      actions: ["batch:DescribeJobs"],
      resources: ["*"],
    }));
    bucket.grantDelete(vercelRole, "outputs/*");
    bucket.grantDelete(vercelRole, "thumbnails/*");
    bucket.grantDelete(vercelRole, "edit-sources/*");
    bucket.grantRead(vercelRole, "outputs/*");

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
    new cdk.CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
    new cdk.CfnOutput(this, "WorkerTaskRoleArn", { value: taskRole.roleArn });
    new cdk.CfnOutput(this, "GithubWorkerBuildRoleArn", { value: githubRole.roleArn });
  }
}
