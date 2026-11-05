import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import path from "node:path";

export interface UploadCandidateProps extends cdk.StackProps {
  releaseId: string;
  administratorId: string;
  expiresAt: string;
  sourceSha: string;
  image: string;
  fontManifest: string;
  previewOrigin: string;
  clusterArn: string;
  listenerArn: string;
  listenerPriority: number;
  loadBalancerDns: string;
  vpcId: string;
  subnets: string[];
  securityGroups: string[];
  executionRoleArn: string;
  controlPlaneRoleArn: string;
  mediaBucket: string;
  // Selected, read-back fields only; never an entire mutable service definition.
  taskTemplate: Pick<ecs.CfnTaskDefinitionProps,
    "volumes" | "ephemeralStorage" | "cpu" | "memory" | "runtimePlatform"> & {
      containerDefinitions: (Omit<ecs.CfnTaskDefinition.ContainerDefinitionProperty, "environment"> & {
        environment?: { name: string; value: string }[];
      })[];
    };
}

/** Separate zero-idle-capacity receiver. Never replaces the public ECS service,
 * capacity table, CDN distribution, listener default or release-check rows. */
export class UploadCandidateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UploadCandidateProps) {
    super(scope, id, props);
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    const prefix = "arn:aws:";
    if (props.env?.account !== "181651591905" || props.env.region !== "ap-northeast-2"
      || !uuid.test(props.releaseId) || !uuid.test(props.administratorId)
      || !/^[a-f0-9]{40}$/.test(props.sourceSha) || !/^[a-f0-9]{64}$/.test(props.fontManifest)
      || !/^181651591905\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com\/shorts-mvp-editor-releases-production@sha256:[a-f0-9]{64}$/.test(props.image)
      || !/^https:\/\/shorts-[a-z0-9]+-artiroom\.vercel\.app$/.test(props.previewOrigin)
      || !Number.isFinite(Date.parse(props.expiresAt))
      || !props.clusterArn.startsWith(`${prefix}ecs:ap-northeast-2:181651591905:cluster/`)
      || !props.listenerArn.startsWith(`${prefix}elasticloadbalancing:ap-northeast-2:181651591905:listener/`)
      || !props.executionRoleArn.startsWith(`${prefix}iam::181651591905:role/`)
      || !props.controlPlaneRoleArn.startsWith(`${prefix}iam::181651591905:role/`)
      || !Number.isInteger(props.listenerPriority) || props.listenerPriority <= 40) {
      throw new Error("Verified production candidate inventory is required");
    }
    const name = `shorts-upload-candidate-${props.releaseId.slice(0, 8)}`;
    const clusterName = props.clusterArn.split("/").at(-1)!;
    const serviceArn = `${prefix}ecs:ap-northeast-2:181651591905:service/${clusterName}/${name}`;
    const originSecret = new cdk.CfnParameter(this, "OriginSecret", {
      type: "String", noEcho: true, minLength: 32, maxLength: 128,
      description: "Fresh candidate-only CloudFront origin header, distinct from public origin header",
    });
    const logGroup = new logs.LogGroup(this, "Logs", {
      logGroupName: `/shorts-mvp/candidate-upload/${props.releaseId}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const group = new elbv2.CfnTargetGroup(this, "Targets", {
      vpcId: props.vpcId, protocol: "HTTP", port: 8080, targetType: "ip",
      healthCheckPath: "/livez", healthCheckIntervalSeconds: 15,
      targetGroupAttributes: [{ key: "deregistration_delay.timeout_seconds", value: "120" }],
    });
    const table = new dynamodb.Table(this, "Capacity", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAtEpoch", removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const coordinator = new lambda.Function(this, "Coordinator", {
      functionName: name, runtime: lambda.Runtime.PYTHON_3_12, handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/file_upload_capacity")),
      timeout: cdk.Duration.seconds(30), memorySize: 256, reservedConcurrentExecutions: 1,
      environment: { ECS_CLUSTER: clusterName, ECS_SERVICE: name, TARGET_GROUP_ARN: group.ref,
        CAPACITY_TABLE: table.tableName, MAX_CAPACITY: "1", WARM_SECONDS: "0",
        UPLOAD_WINDOW_SECONDS: "900", CLAIMED_LEASE_SECONDS: "3600" },
    });
    table.grantReadWriteData(coordinator);
    coordinator.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeServices", "ecs:UpdateService"], resources: [serviceArn],
    }));
    coordinator.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ecs:ListTasks", "ecs:DescribeTasks", "ecs:GetTaskProtection"], resources: ["*"],
      conditions: { ArnEquals: { "ecs:cluster": props.clusterArn } },
    }));
    coordinator.addToRolePolicy(new iam.PolicyStatement({
      actions: ["elasticloadbalancing:DescribeTargetHealth"], resources: ["*"],
    }));
    new events.Rule(this, "Reconcile", {
      enabled: false,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(coordinator, {
        event: events.RuleTargetInput.fromObject({ action: "reconcile" }),
      })],
    });
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:UpdateTaskProtection"], resources: ["*"],
      conditions: { ArnEquals: { "ecs:cluster": props.clusterArn } } }));
    const bucketArn = `arn:aws:s3:::${props.mediaBucket}`;
    const media = ["outputs/*", "thumbnails/*", "edit-sources/*"];
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      resources: media.map(p => `${bucketArn}/${p}`) }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [bucketArn],
      conditions: { StringLike: { "s3:prefix": media } } }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [`${bucketArn}/custom-backgrounds/*`] }));
    coordinator.grantInvoke(taskRole);
    coordinator.grantInvoke(iam.Role.fromRoleArn(this, "WebRole", props.controlPlaneRoleArn));
    const containers = props.taskTemplate.containerDefinitions;
    if (!Array.isArray(containers) || containers.length !== 2
      || !containers.some(c => c.name === "file-upload-receiver")) throw new Error("Exact receiver task template required");
    const environment = {
      FILE_UPLOAD_CANDIDATE_RELEASE_ID: props.releaseId, FILE_UPLOAD_CANDIDATE_ADMIN_ID: props.administratorId,
      FILE_UPLOAD_CANDIDATE_EXPIRES_AT: props.expiresAt, FILE_UPLOAD_CAPACITY_FUNCTION_ARN: coordinator.functionArn,
      FILE_UPLOAD_CORS_ALLOWED_ORIGINS: props.previewOrigin, MIDFORM_ENABLED: "false", MIDFORM_RELEASE_ID: "",
      EDITOR_RELEASE_GIT_SHA: props.sourceSha, WORKER_IMAGE_DIGEST: props.image.split("@")[1],
      WORKER_IMAGE_TAG: `editor-release-${props.sourceSha}`, EDITOR_FONT_MANIFEST_SHA256: props.fontManifest,
    };
    const task = new ecs.CfnTaskDefinition(this, "Task", {
      ...props.taskTemplate, family: name, networkMode: "awsvpc", requiresCompatibilities: ["FARGATE"],
      executionRoleArn: props.executionRoleArn, taskRoleArn: taskRole.roleArn,
      containerDefinitions: containers.map(container => ({ ...container, image: props.image,
        logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": logGroup.logGroupName,
          "awslogs-region": "ap-northeast-2", "awslogs-stream-prefix": container.name } },
        ...(container.name === "file-upload-receiver" ? { environment: [
          ...(Array.isArray(container.environment) ? container.environment.filter(e => !(e.name in environment)) : []),
          ...Object.entries(environment).map(([name, value]) => ({ name, value })),
        ] } : {}),
      })),
    });
    const rule = new elbv2.CfnListenerRule(this, "PrivateRoute", {
      listenerArn: props.listenerArn, priority: props.listenerPriority,
      conditions: [{ field: "path-pattern", values: [`/admin-upload/${props.releaseId}/*`] },
        { field: "http-header", httpHeaderConfig: { httpHeaderName: "x-easycut-origin-verify", values: [originSecret.valueAsString] } }],
      actions: [{ type: "forward", targetGroupArn: group.ref }],
    });
    const service = new ecs.CfnService(this, "Service", {
      cluster: props.clusterArn, serviceName: name, taskDefinition: task.ref, desiredCount: 0,
      launchType: "FARGATE", platformVersion: "1.4.0", healthCheckGracePeriodSeconds: 120,
      deploymentConfiguration: { maximumPercent: 100, minimumHealthyPercent: 0 },
      networkConfiguration: { awsvpcConfiguration: { assignPublicIp: "ENABLED", subnets: props.subnets, securityGroups: props.securityGroups } },
      loadBalancers: [{ targetGroupArn: group.ref, containerName: "file-upload-receiver", containerPort: 8080 }],
    });
    service.addDependency(rule);
    const cdn = new cloudfront.CfnDistribution(this, "ReceiverCdn", { distributionConfig: {
      enabled: true, priceClass: "PriceClass_200",
      origins: [{ id: "candidate", domainName: props.loadBalancerDns,
        customOriginConfig: { originProtocolPolicy: "http-only", originReadTimeout: 120, originKeepaliveTimeout: 120 },
        originCustomHeaders: [{ headerName: "x-easycut-origin-verify", headerValue: originSecret.valueAsString }] }],
      defaultCacheBehavior: { targetOriginId: "candidate", viewerProtocolPolicy: "https-only",
        allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"], cachedMethods: ["GET", "HEAD"],
        cachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
        originRequestPolicyId: cloudfront.OriginRequestPolicy.ALL_VIEWER.originRequestPolicyId },
    } });
    new cdk.CfnOutput(this, "ReceiverUrl", { value: `https://${cdn.attrDomainName}/admin-upload/${props.releaseId}` });
    new cdk.CfnOutput(this, "CapacityFunctionArn", { value: coordinator.functionArn });
  }
}
