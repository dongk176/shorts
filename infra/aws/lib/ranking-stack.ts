import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { Construct } from "constructs";
import path from "node:path";

export interface RankingProps extends cdk.StackProps {
  proxyDestinations: { address: string; port: number }[];
  vpcId: string;
  vpcCidr: string;
  subnets: string[];
  availabilityZones: string[];
  albSecurityGroupId: string;
  listenerArn: string;
  listenerPriority: number;
  vpcOriginId: string;
  albDnsName: string;
  image: string;
  sourceCommit: string;
  runtimeSecretArn: string;
  outputBucket: string;
  vercelRoleArn: string;
  allowedOrigins: string[];
}
export class RankingAdminStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RankingProps) {
    super(scope, id, props);
    if (
      props.env?.account !== "181651591905" ||
      props.env.region !== "ap-northeast-2"
    )
      throw new Error("Ranking production account mismatch");
    if (
      !/^181651591905\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com\/[\w/-]+@sha256:[a-f0-9]{64}$/.test(
        props.image,
      ) ||
      !/^[a-f0-9]{40}$/.test(props.sourceCommit)
    )
      throw new Error("Exact image digest and source commit required");
    for (const arn of [
      props.listenerArn,
      props.runtimeSecretArn,
      props.vercelRoleArn,
    ])
      if (!arn.includes(":181651591905:"))
        throw new Error("Cross-account ranking dependency");
    if (
      !props.subnets.length ||
      props.subnets.length !== props.availabilityZones.length ||
      props.listenerPriority < 1 ||
      props.listenerPriority > 50000
    )
      throw new Error("Verified network inventory required");
    if (
      !/^vo_[A-Za-z0-9]+$/.test(props.vpcOriginId) ||
      !/^[a-zA-Z0-9-]+\.ap-northeast-2\.elb\.amazonaws\.com$/.test(
        props.albDnsName,
      )
    )
      throw new Error("Verified existing private CloudFront origin required");
    if (
      !props.allowedOrigins.length ||
      props.allowedOrigins.some(
        (origin) =>
          !/^https:\/\/(?:www\.)?easycut\.co\.kr$|^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(
            origin,
          ),
      )
    )
      throw new Error("Exact production/candidate CORS origins required");
    const vpc = ec2.Vpc.fromVpcAttributes(this, "ExistingUploadVpc", {
      vpcId: props.vpcId,
      vpcCidrBlock: props.vpcCidr,
      availabilityZones: props.availabilityZones,
      publicSubnetIds: props.subnets,
    });
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ExistingAlbSecurityGroup",
      props.albSecurityGroupId,
      { mutable: false },
    );
    const sg = new ec2.SecurityGroup(this, "RankingSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "Isolated administrator ranking receiver",
    });
    sg.addIngressRule(albSg, ec2.Port.tcp(8080));
    new ec2.CfnSecurityGroupEgress(this, "ExistingAlbToRanking", {
      groupId: props.albSecurityGroupId,
      destinationSecurityGroupId: sg.securityGroupId,
      ipProtocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      description: "Forward ranking path to isolated receiver only",
    });
    for (const port of [443, 5432, 6543])
      sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(port));
    if (!props.proxyDestinations?.length || props.proxyDestinations.length > 32)
      throw new Error("Verified Webshare destinations required");
    for (const { address, port } of props.proxyDestinations) {
      const octets = address.split(".").map(Number);
      if (
        !/^\d{1,3}(\.\d{1,3}){3}$/.test(address) ||
        octets.some((part) => part > 255) ||
        [0, 10, 127].includes(octets[0]) || octets[0] >= 224 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        !Number.isInteger(port) || port < 1 || port > 65535
      ) throw new Error("Webshare must use a verified public IPv4 and port");
      sg.addEgressRule(ec2.Peer.ipv4(`${address}/32`), ec2.Port.tcp(port), "Configured Webshare IP");
    }
    sg.addEgressRule(ec2.Peer.ipv4(props.vpcCidr), ec2.Port.udp(53));
    sg.addEgressRule(ec2.Peer.ipv4(props.vpcCidr), ec2.Port.tcp(53));
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: "shorts-ranking-production",
    });
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    // No source, edit-source, or ordinary output access.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:AbortMultipartUpload"],
        resources: [`arn:aws:s3:::${props.outputBucket}/outputs/ranking/*`],
      }),
    );
    const [repositoryUri, digest] = props.image.split("@");
    const repositoryName = repositoryUri.split("/").slice(1).join("/");
    const repository = ecr.Repository.fromRepositoryAttributes(
      this,
      "ExistingImageRepository",
      {
        repositoryArn: `arn:aws:ecr:ap-northeast-2:181651591905:repository/${repositoryName}`,
        repositoryName,
      },
    );
    const image = ecs.ContainerImage.fromEcrRepository(repository, digest);
    const runtime = secrets.Secret.fromSecretCompleteArn(
      this,
      "RuntimeSecret",
      props.runtimeSecretArn,
    );
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      family: "shorts-ranking-production",
      cpu: 2048,
      memoryLimitMiB: 4096,
      ephemeralStorageGiB: 30,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    task.addVolume({ name: "scratch" });
    const logGroup = new logs.LogGroup(this, "Logs", {
      logGroupName: "/shorts-mvp/production/ranking",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const lease = new dynamodb.Table(this, "Lease", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const functionName = "shorts-ranking-capacity-production";
    const functionArn = this.formatArn({
      service: "lambda",
      resource: "function",
      resourceName: functionName,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    const init = task.addContainer("ScratchInit", {
      image,
      essential: false,
      user: "0",
      entryPoint: ["/bin/sh", "-c"],
      command: [
        "mkdir -p /scratch/ranking && chown -R 10001:10001 /scratch/ranking && chmod 700 /scratch/ranking",
      ],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "init" }),
    });
    init.addMountPoints({
      sourceVolume: "scratch",
      containerPath: "/scratch",
      readOnly: false,
    });
    const container = task.addContainer("RankingReceiver", {
      image,
      user: "10001",
      essential: true,
      readonlyRootFilesystem: true,
      entryPoint: ["python", "-m", "shorts_worker.ranking_service"],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "receiver" }),
      environment: {
        RANKING_STORAGE_ROOT: "/scratch/ranking",
        TMPDIR: "/scratch",
        AWS_REGION: "ap-northeast-2",
        AWS_S3_OUTPUT_BUCKET: props.outputBucket,
        RANKING_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
        RANKING_CAPACITY_FUNCTION_ARN: functionArn,
        RANKING_SOURCE_COMMIT: props.sourceCommit,
        YTDLP_NO_PLUGINS: "1",
        RANKING_WEBSHARE_ENABLED: "1",
      },
      secrets: {
        INGESTION_PROXY_ROUTES_JSON: ecs.Secret.fromSecretsManager(
          runtime,
          "INGESTION_PROXY_ROUTES_JSON",
        ),
        DATABASE_URL: ecs.Secret.fromSecretsManager(
          runtime,
          "RANKING_DATABASE_URL",
        ),
        RANKING_TOKEN_SECRET: ecs.Secret.fromSecretsManager(
          runtime,
          "RANKING_TOKEN_SECRET",
        ),
        RANKING_ORIGIN_SECRET: ecs.Secret.fromSecretsManager(
          runtime,
          "RANKING_ORIGIN_SECRET",
        ),
      },
    });
    container.addMountPoints({
      sourceVolume: "scratch",
      containerPath: "/scratch",
      readOnly: false,
    });
    container.addPortMappings({ containerPort: 8080 });
    container.addContainerDependencies({
      container: init,
      condition: ecs.ContainerDependencyCondition.SUCCESS,
    });
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: task,
      serviceName: "shorts-ranking-production",
      desiredCount: 0,
      assignPublicIp: true,
      vpcSubnets: {
        subnets: props.subnets.map((id, i) =>
          ec2.Subnet.fromSubnetId(this, `Public${i}`, id),
        ),
      },
      securityGroups: [sg],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      enableExecuteCommand: false,
      healthCheckGracePeriod: cdk.Duration.minutes(3),
    });
    const target = new elb.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: 8080,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: "/ranking/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });
    target.addTarget(service);
    const originHeader = runtime
      .secretValueFromJson("RANKING_ORIGIN_SECRET")
      .unsafeUnwrap();
    new elb.CfnListenerRule(this, "RankingPathOnly", {
      listenerArn: props.listenerArn,
      priority: props.listenerPriority,
      conditions: [
        { field: "path-pattern", values: ["/ranking/*"] },
        {
          field: "http-header",
          httpHeaderConfig: {
            httpHeaderName: "x-easycut-origin-verify",
            values: [originHeader],
          },
        },
      ],
      actions: [{ type: "forward", targetGroupArn: target.targetGroupArn }],
    });
    // A distinct header bypasses the ordinary upload listener's priority-1
    // header rule. Its distribution, rule and receiver stay untouched.
    const privateOrigin = cloudfront.VpcOrigin.fromVpcOriginAttributes(
      this,
      "ExistingPrivateOrigin",
      {
        vpcOriginId: props.vpcOriginId,
        domainName: props.albDnsName,
      },
    );
    const distribution = new cloudfront.Distribution(
      this,
      "RankingDistribution",
      {
        comment: "Private administrator ranking receiver",
        defaultBehavior: {
          origin: origins.VpcOrigin.withVpcOrigin(privateOrigin, {
            customHeaders: { "x-easycut-origin-verify": originHeader },
            readTimeout: cdk.Duration.seconds(30),
            keepaliveTimeout: cdk.Duration.seconds(30),
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      },
    );
    const capacity = new lambda.Function(this, "Capacity", {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambda/ranking_capacity"),
      ),
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        LEASE_TABLE: lease.tableName,
        CLUSTER: cluster.clusterArn,
        SERVICE: service.serviceName,
        TARGET_GROUP_ARN: target.targetGroupArn,
      },
    });
    lease.grantReadWriteData(capacity);
    capacity.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeServices", "ecs:UpdateService"],
        resources: [service.serviceArn],
      }),
    );
    capacity.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["elasticloadbalancing:DescribeTargetHealth"],
        resources: ["*"],
      }),
    );
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [functionArn],
      }),
    );
    const webRole = iam.Role.fromRoleArn(
      this,
      "ExistingWebRole",
      props.vercelRoleArn,
      { mutable: true },
    );
    capacity.grantInvoke(webRole);
    new events.Rule(this, "IdleStop", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [
        new targets.LambdaFunction(capacity, {
          event: events.RuleTargetInput.fromObject({ action: "sweep" }),
        }),
      ],
    });
    new cdk.CfnOutput(this, "CapacityArn", { value: capacity.functionArn });
    new cdk.CfnOutput(this, "ReceiverUrl", {
      value: `https://${distribution.distributionDomainName}/ranking/v1`,
    });
    new cdk.CfnOutput(this, "TaskDefinitionArn", {
      value: task.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, "TargetGroupArn", { value: target.targetGroupArn });
  }
}
