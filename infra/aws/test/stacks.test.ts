import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  ShortsMvpComputeStack,
  ShortsMvpElevenLabsTranscriptionStack,
  ShortsMvpEditorCanaryStack,
  ShortsMvpEditorReleaseRepositoryStack,
  ShortsMvpEditorTestStack,
  ShortsMvpFoundationStack,
  ShortsMvpSourceRangeStack,
} from "../lib/stacks";

function stacks(
  environment = "test",
  contextOverrides: Record<string, string> = {},
) {
  const app = new cdk.App({ context: {
    vercelTeamSlug: "team",
    vercelProjectName: "shorts",
    workerImageTag: "test-worker-image",
    legacyRerenderImageTag: "legacy-worker-image",
    legacyProjectJobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy-project:1",
    legacyProjectBatchQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy-project",
    sourceRangeJobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/source-range:1",
    sourceRangeBatchQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/source-range",
    elevenLabsTranscriptionJobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs-canary:1",
    elevenLabsTranscriptionBatchQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
    subtitleTemplatesJobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitle-canary:2",
    subtitleTemplatesBatchQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
    unifiedTemplateSubtitlesJobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles:3",
    unifiedTemplateSubtitlesBatchQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified-template-subtitles",
    ...contextOverrides,
  } });
  const env = { account: "123456789012", region: "ap-northeast-2" };
  const editorRepositoryStack = new ShortsMvpEditorReleaseRepositoryStack(
    app,
    "EditorRepository",
    { env, environment },
  );
  const foundation = new ShortsMvpFoundationStack(app, "Foundation", {
    env,
    environment,
    editorReleaseRepository: editorRepositoryStack.repository,
  });
  const compute = new ShortsMvpComputeStack(app, "Compute", {
    env,
    environment,
    foundation,
  });
  const editorCanaryStack = new ShortsMvpEditorCanaryStack(app, "EditorCanary", {
    env,
    environment,
    foundation,
  });
  return {
    editorRepository: Template.fromStack(editorRepositoryStack),
    foundation: Template.fromStack(foundation),
    compute: Template.fromStack(compute),
    editorCanary: Template.fromStack(editorCanaryStack),
  };
}

function editorTestStack() {
  const app = new cdk.App({ context: {
    workerImageTag: "test-worker-image",
  } });
  const env = { account: "123456789012", region: "ap-northeast-2" };
  const editorRepositoryStack = new ShortsMvpEditorReleaseRepositoryStack(
    app,
    "EditorRepository",
    { env, environment: "production" },
  );
  const foundationStack = new ShortsMvpFoundationStack(app, "Foundation", {
    env,
    environment: "production",
    editorReleaseRepository: editorRepositoryStack.repository,
  });
  const editorTest = new ShortsMvpEditorTestStack(app, "EditorTest", {
    env,
    environment: "editor-test",
    foundation: foundationStack,
  });
  return Template.fromStack(editorTest);
}

function sourceRangeStack() {
  const digest = `sha256:${"a".repeat(64)}`;
  const app = new cdk.App({ context: {
    sourceRangeSubnetIds: "subnet-aaaa,subnet-bbbb",
    sourceRangeSecurityGroupId: "sg-aaaa",
    sourceRangeExecutionRoleArn:
      "arn:aws:iam::123456789012:role/worker-execution",
    sourceRangeTaskRoleArn: "arn:aws:iam::123456789012:role/worker-task",
    sourceRangeLogGroupName: "/shorts-mvp/production/worker",
    sourceRangeRuntimeSecretArn:
      "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:runtime-test",
    sourceRangeMediaBucketName: "shorts-media",
    sourceRangeWorkQueueUrl:
      "https://sqs.ap-northeast-2.amazonaws.com/123456789012/work",
    sourceRangeStateQueueUrl:
      "https://sqs.ap-northeast-2.amazonaws.com/123456789012/state",
    sourceRangeRepositoryUri:
      "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-worker-production",
    sourceRangeImageDigest: digest,
  } });
  const stack = new ShortsMvpSourceRangeStack(app, "SourceRange", {
    env: { account: "123456789012", region: "ap-northeast-2" },
    environment: "production",
  });
  return Template.fromStack(stack);
}

function elevenLabsTranscriptionStack() {
  const digest = `sha256:${"b".repeat(64)}`;
  const app = new cdk.App({ context: {
    sourceRangeSubnetIds: "subnet-aaaa,subnet-bbbb",
    sourceRangeSecurityGroupId: "sg-aaaa",
    sourceRangeExecutionRoleArn:
      "arn:aws:iam::123456789012:role/worker-execution",
    sourceRangeTaskRoleArn: "arn:aws:iam::123456789012:role/worker-task",
    sourceRangeLogGroupName: "/shorts-mvp/production/worker",
    sourceRangeRuntimeSecretArn:
      "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:runtime-test",
    sourceRangeMediaBucketName: "shorts-media",
    sourceRangeWorkQueueUrl:
      "https://sqs.ap-northeast-2.amazonaws.com/123456789012/work",
    sourceRangeStateQueueUrl:
      "https://sqs.ap-northeast-2.amazonaws.com/123456789012/state",
    sourceRangeRepositoryUri:
      "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-worker-production",
    sourceRangeSchedulingPolicyArn:
      "arn:aws:batch:ap-northeast-2:123456789012:scheduling-policy/source-range-test",
    elevenLabsTranscriptionImageDigest: digest,
  } });
  const stack = new ShortsMvpElevenLabsTranscriptionStack(
    app,
    "ElevenLabsTranscription",
    {
      env: { account: "123456789012", region: "ap-northeast-2" },
      environment: "production",
    },
  );
  return Template.fromStack(stack);
}

describe("ElevenLabs transcription stack", () => {
  it("owns isolated capacity and an immutable candidate definition", () => {
    const template = elevenLabsTranscriptionStack();
    template.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeEnvironmentName:
        "shorts-mvp-elevenlabs-transcription-fargate-production",
      ComputeResources: Match.objectLike({ Type: "FARGATE", MaxvCpus: 32 }),
    });
    template.hasResourceProperties("AWS::Batch::JobQueue", {
      JobQueueName:
        "shorts-mvp-elevenlabs-transcription-canary-production",
      SchedulingPolicyArn: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName:
        "shorts-mvp-elevenlabs-transcription-canary-production",
      ContainerProperties: Match.objectLike({
        Image: Match.stringLikeRegexp("@sha256:b{64}$"),
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: "ELEVENLABS_API_KEY" }),
        ]),
        Environment: Match.arrayWith([
          { Name: "ELEVENLABS_TRANSCRIBE_MODEL", Value: "scribe_v2" },
          { Name: "OPENAI_TRANSCRIBE_FALLBACK_MODEL", Value: "whisper-1" },
          { Name: "GEMINI_TEXT_MODEL", Value: "gemini-3.5-flash-lite" },
          { Name: "GEMINI_COMMENT_MODEL", Value: "gemini-2.5-flash-lite" },
          { Name: "PROJECT_RESOURCE_TIER", Value: "elevenlabs_transcription" },
        ]),
        ResourceRequirements: Match.arrayWith([
          { Type: "VCPU", Value: "8" },
          { Type: "MEMORY", Value: "16384" },
        ]),
      }),
    });
  });
});

describe("source range stack", () => {
  it("isolates capacity and pins the worker image digest", () => {
    const template = sourceRangeStack();
    template.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeEnvironmentName: "shorts-mvp-source-range-fargate-production",
      ComputeResources: Match.objectLike({ Type: "FARGATE", MaxvCpus: 160 }),
    });
    template.hasResourceProperties("AWS::Batch::JobQueue", {
      JobQueueName: "shorts-mvp-source-range-production",
    });
    template.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-source-range-v1-production",
      Timeout: { AttemptDurationSeconds: 18000 },
      ContainerProperties: Match.objectLike({
        Image: Match.stringLikeRegexp("@sha256:a{64}$"),
        LinuxParameters: { InitProcessEnabled: true },
        EphemeralStorage: { SizeInGiB: 80 },
        Environment: Match.arrayWith([
          { Name: "GEMINI_TEXT_MODEL", Value: "gemini-3.5-flash-lite" },
          { Name: "GEMINI_COMMENT_MODEL", Value: "gemini-2.5-flash-lite" },
          { Name: "PROJECT_RESOURCE_TIER", Value: "source_range" },
          { Name: "MAX_VIDEO_DURATION_SECONDS", Value: "14400" },
          { Name: "DOWNLOAD_TIMEOUT_SECONDS", Value: "14400" },
        ]),
        ResourceRequirements: Match.arrayWith([
          { Type: "VCPU", Value: "8" },
          { Type: "MEMORY", Value: "16384" },
        ]),
      }),
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern:
        '{ $.event = "source_download_observed" && $.source_range_enabled = true && $.status = "full_source_expected" }',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({ MetricName: "SourceRangeFullSourceExpected" }),
      ]),
    });
  });
});

describe("shorts MVP infrastructure", () => {
  it("keeps immutable editor releases outside the rolling worker image policy", () => {
    const { editorRepository, foundation } = stacks();
    const editorRepositories = editorRepository.findResources("AWS::ECR::Repository");
    const editorReleaseRepository = Object.values(editorRepositories).find(
      (resource) => (
        resource.Properties?.RepositoryName
        === "shorts-mvp-editor-releases-test"
      ),
    );

    expect(editorReleaseRepository).toBeDefined();
    expect(editorReleaseRepository?.Properties?.ImageTagMutability).toBe("IMMUTABLE");
    expect(editorReleaseRepository?.Properties?.LifecyclePolicy).toBeUndefined();
    const workerRepositories = foundation.findResources("AWS::ECR::Repository");
    const workerRepository = Object.values(workerRepositories).find(
      (resource) => resource.Properties?.RepositoryName === "shorts-mvp-worker-test",
    );
    const lifecycle = JSON.parse(
      workerRepository?.Properties?.LifecyclePolicy?.LifecyclePolicyText || "{}",
    );
    expect(lifecycle.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selection: expect.objectContaining({
          tagPrefixList: ["legacy-rerender-"],
        }),
      }),
    ]));
  });

  it("limits editor release tagging to verified definition name prefixes", () => {
    const { editorCanary } = stacks("production");
    const templateJson = JSON.stringify(editorCanary.toJSON());

    expect(templateJson).toContain('"batch:TagResource"');
    expect(templateJson).toContain("job-definition/shorts-mvp-editor-release-*");
    expect(templateJson).toContain(
      "job-definition/shorts-mvp-editor-test-release-*",
    );
  });

  it("trusts editor release builds from main and the exact subtitle candidate only", () => {
    const { editorCanary } = stacks("production");
    const roles = editorCanary.findResources("AWS::IAM::Role");
    const editorReleaseRole = Object.entries(roles).find(([logicalId]) => (
      logicalId.startsWith("EditorReleaseBuildRole")
    ))?.[1];
    const subject = editorReleaseRole?.Properties?.AssumeRolePolicyDocument
      ?.Statement?.[0]?.Condition?.StringLike
      ?.["token.actions.githubusercontent.com:sub"];

    expect(subject).toEqual([
      "repo:dongk176/shorts:ref:refs/heads/main",
      "repo:dongk176/shorts:ref:refs/heads/codex/unified-template-subtitles-admin-canary-20260824",
    ]);
    expect(JSON.stringify(subject)).not.toContain("codex/*");
  });

  it("enables verified paid Gemini processing only in production", () => {
    const testTemplate = JSON.stringify(stacks().compute.toJSON());
    const productionTemplate = JSON.stringify(stacks("production").compute.toJSON());

    expect(testTemplate).toContain(
      '"Name":"GEMINI_PAID_DATA_PROCESSING_CONFIRMED","Value":"false"',
    );
    expect(productionTemplate).toContain(
      '"Name":"GEMINI_PAID_DATA_PROCESSING_CONFIRMED","Value":"true"',
    );
  });

  it("keeps S3 private, expires regular media, and retains example media", () => {
    const { foundation } = stacks();
    foundation.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: "outputs/", ExpirationInDays: 30, Status: "Enabled" }),
          Match.objectLike({ Prefix: "thumbnails/", ExpirationInDays: 30, Status: "Enabled" }),
          Match.objectLike({ Prefix: "edit-sources/", ExpirationInDays: 30, Status: "Enabled" }),
        ]),
      },
    });
    foundation.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    foundation.resourceCountIs("AWS::CloudFront::Function", 2);
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/outputs/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/thumbnails/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/examples/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/edit-sources/"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("content-disposition"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("filename\\*=UTF-8"),
    });
    foundation.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
            Match.objectLike({ EventType: "viewer-response" }),
          ]),
        }),
      },
    });
  });

  it("uses scalable Prepare Fargate and zero-idle Render Spot with fallback", () => {
    const { compute } = stacks();
    compute.resourceCountIs("AWS::EC2::NatGateway", 0);
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({ MaxvCpus: 4000, Type: "FARGATE" }),
    });
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({
        MaxvCpus: 4000, MinvCpus: 0, Type: "SPOT",
        AllocationStrategy: "SPOT_PRICE_CAPACITY_OPTIMIZED",
      }),
    });
    compute.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({ MaxvCpus: 4000, MinvCpus: 0, Type: "EC2" }),
    });
    compute.hasResourceProperties("AWS::Batch::SchedulingPolicy", {
      FairsharePolicy: {
        ComputeReservation: 10,
        ShareDecaySeconds: 600,
        ShareDistribution: [
          { ShareIdentifier: "paid*", WeightFactor: 0.25 },
          { ShareIdentifier: "free*", WeightFactor: 1 },
        ],
      },
    });
    compute.hasResourceProperties("AWS::Batch::JobQueue", {
      JobQueueName: "shorts-mvp-render-fair-test",
      SchedulingPolicyArn: Match.anyValue(),
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        RuntimePlatform: {
          CpuArchitecture: "X86_64",
          OperatingSystemFamily: "LINUX",
        },
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: "INGESTION_PROXY_ROUTES_JSON" }),
        ]),
      }),
    });
    const jobDefinitions = Object.values(
      compute.findResources("AWS::Batch::JobDefinition")
    ) as Array<Record<string, unknown>>;
    const jobDefinition = (name: string) => jobDefinitions.find((definition) => (
      (definition.Properties as Record<string, unknown>)?.JobDefinitionName === name
    ));
    const prepareJobDefinition = jobDefinition("shorts-mvp-prepare-test");
    const renderJobDefinition = jobDefinition("shorts-mvp-render-test");
    const projectJobDefinition = jobDefinition("shorts-mvp-project-fargate-test");
    const projectHeavyJobDefinition = jobDefinition("shorts-mvp-project-heavy-fargate-test");
    const rerenderJobDefinition = jobDefinition("shorts-mvp-rerender-fargate-test");

    expect(prepareJobDefinition).toBeDefined();
    expect(renderJobDefinition).toBeDefined();
    expect(projectJobDefinition).toBeDefined();
    expect(projectHeavyJobDefinition).toBeDefined();
    expect(rerenderJobDefinition).toBeDefined();
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_EGRESS_MODE");
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_BOT_CHECK_COOLDOWN_SECONDS");
    expect(JSON.stringify(prepareJobDefinition)).toContain("INGESTION_PROXY_ROUTES_JSON");
    expect(JSON.stringify(renderJobDefinition)).not.toContain("INGESTION_");
    expect(
      jobDefinitions.filter((definition) => (
        JSON.stringify(definition).includes("INGESTION_PROXY_ROUTES_JSON")
      ))
    ).toHaveLength(3);
    expect(
      jobDefinitions.filter((definition) => (
        JSON.stringify(definition).includes("INGESTION_EGRESS_MODE")
      ))
    ).toHaveLength(3);
    expect(JSON.stringify(jobDefinitions)).not.toContain("WARP_CONF_B64");
    expect(JSON.stringify(compute.toJSON())).toContain("test-worker-image");
    expect(JSON.stringify(prepareJobDefinition)).toContain("test-worker-image-prepare");
    expect(JSON.stringify(renderJobDefinition)).toContain("test-worker-image");
    expect(JSON.stringify(renderJobDefinition)).not.toContain("test-worker-image-prepare");
    expect(JSON.stringify(renderJobDefinition)).toContain('"Type":"VCPU","Value":"2"');
    expect(JSON.stringify(renderJobDefinition)).toContain('"Type":"MEMORY","Value":"8192"');
    expect(JSON.stringify(projectJobDefinition)).toContain('"Type":"VCPU","Value":"4"');
    expect(JSON.stringify(projectJobDefinition)).toContain('"Type":"MEMORY","Value":"30720"');
    expect(JSON.stringify(projectJobDefinition)).toContain('"SizeInGiB":30');
    expect(JSON.stringify(projectJobDefinition)).toContain(
      '"Name":"PROJECT_RESOURCE_TIER","Value":"standard"',
    );
    expect(JSON.stringify(projectHeavyJobDefinition)).toContain('"Type":"VCPU","Value":"8"');
    expect(JSON.stringify(projectHeavyJobDefinition)).toContain(
      '"Type":"MEMORY","Value":"16384"',
    );
    expect(JSON.stringify(projectHeavyJobDefinition)).toContain('"SizeInGiB":30');
    expect(JSON.stringify(projectHeavyJobDefinition)).toContain(
      '"Name":"PROJECT_RESOURCE_TIER","Value":"heavy"',
    );
    expect(JSON.stringify(rerenderJobDefinition)).toContain('"Type":"VCPU","Value":"2"');
    expect(JSON.stringify(rerenderJobDefinition)).toContain('"Type":"MEMORY","Value":"16384"');
    expect(JSON.stringify(rerenderJobDefinition)).toContain("legacy-worker-image");
    expect(JSON.stringify(rerenderJobDefinition)).not.toContain("test-worker-image");
    expect(JSON.stringify(compute.toJSON())).not.toContain(":latest");
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      ContainerProperties: Match.objectLike({
        Environment: Match.arrayWith([
          { Name: "AWS_REGION", Value: "ap-northeast-2" },
          { Name: "AWS_DEFAULT_REGION", Value: "ap-northeast-2" },
          { Name: "OPENAI_TRANSCRIBE_MODEL", Value: "gpt-4o-mini-transcribe" },
          { Name: "OPENAI_HIGHLIGHT_FALLBACK_MODEL", Value: "gpt-5-nano" },
          { Name: "OPENAI_COMMENT_FALLBACK_MODEL", Value: "gpt-5-nano" },
          { Name: "GEMINI_TEXT_MODEL", Value: "gemini-3.5-flash-lite" },
          { Name: "GEMINI_COMMENT_MODEL", Value: "gemini-2.5-flash-lite" },
          { Name: "OPENAI_TRANSCRIBE_CHUNK_SECONDS", Value: "30" },
          { Name: "OPENAI_TRANSCRIBE_MAX_WORKERS", Value: "4" },
          { Name: "FFMPEG_THREADS", Value: "2" },
          { Name: "CLEAN_CLIP_PRESET", Value: "superfast" },
          { Name: "CLEAN_CLIP_CRF", Value: "20" },
          { Name: "INGESTION_EGRESS_MODE", Value: "webshare_isp" },
          { Name: "INGESTION_BOT_CHECK_COOLDOWN_SECONDS", Value: "30" },
        ]),
      }),
    });
    compute.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
    compute.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupEgress: Match.arrayWith([Match.objectLike({
        IpProtocol: "tcp",
        FromPort: 1000,
        ToPort: 9999,
      })]),
    });
  });

  it("keeps editor canary work on a separate four-vCPU production queue", () => {
    const { editorCanary } = stacks();

    editorCanary.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({
        MaxvCpus: 4,
        Type: "FARGATE",
      }),
    });
    editorCanary.hasResourceProperties("AWS::Batch::JobQueue", {
      JobQueueName: "shorts-mvp-editor-canary-test",
      Priority: 1,
    });
    editorCanary.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "batch_submitter.handler",
      Environment: {
        Variables: Match.objectLike({
          EDITOR_STABLE_BATCH_QUEUE: Match.anyValue(),
          EDITOR_CANARY_BATCH_QUEUE: Match.anyValue(),
          EDITOR_TEST_TEMPLATE_JOB_DEFINITION:
            "shorts-mvp-editor-test-template",
          RERENDER_JOB_DEFINITION: "shorts-mvp-rerender-fargate-test",
        }),
      },
    });
    editorCanary.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "editor_outbox_dispatcher.handler",
    });
  });

  it("provisions isolated editor tests with separate ephemeral storage and max 4 vCPU", () => {
    const editorTest = editorTestStack();

    editorTest.hasResourceProperties("AWS::Batch::ComputeEnvironment", {
      ComputeResources: Match.objectLike({
        MaxvCpus: 4,
        Type: "FARGATE",
      }),
    });
    editorTest.hasResourceProperties("AWS::Batch::JobQueue", {
      JobQueueName: "shorts-mvp-editor-test",
      Priority: 1,
    });
    editorTest.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ ExpirationInDays: 3, Status: "Enabled" }),
        ]),
      },
      PublicAccessBlockConfiguration: Match.objectLike({
        RestrictPublicBuckets: true,
      }),
    });
    editorTest.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-editor-test-template",
      ContainerProperties: Match.objectLike({
        Image: Match.anyValue(),
        ResourceRequirements: Match.arrayWith([
          { Type: "VCPU", Value: "2" },
          { Type: "MEMORY", Value: "16384" },
        ]),
      }),
    });
    expect(JSON.stringify(editorTest.toJSON())).toContain("test-worker-image");
    expect(JSON.stringify(editorTest.toJSON())).not.toContain(
      "shorts-mvp/production/worker-runtime",
    );
  });

  it("uses bounded Prepare and Render attempts with a one-minute SQS retry", () => {
    const { compute } = stacks();
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      RetryStrategy: {
        Attempts: 1,
      },
      Timeout: { AttemptDurationSeconds: 3600 },
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-render-test",
      RetryStrategy: { Attempts: 1 },
      Timeout: { AttemptDurationSeconds: 1200 },
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-project-fargate-test",
      RetryStrategy: { Attempts: 1 },
      Timeout: { AttemptDurationSeconds: 7200 },
    });
    compute.hasResourceProperties("AWS::Batch::JobDefinition", {
      JobDefinitionName: "shorts-mvp-project-heavy-fargate-test",
      RetryStrategy: { Attempts: 1 },
      Timeout: { AttemptDurationSeconds: 7200 },
    });
    compute.resourceCountIs("AWS::Logs::MetricFilter", 23);
    for (const metricName of [
      "RenderComputeFactor",
      "RenderFfmpegShare",
      "RenderPhaseCpuUtilization",
      "ProjectRenderWallSeconds",
      "ProjectExtractionWallSeconds",
      "CleanClipBytesPerSecond",
      "LocalCleanReuseCount",
      "S3CleanDownloadCount",
      "ProjectStandardStarted",
      "ProjectHeavyStarted",
    ]) {
      compute.hasResourceProperties("AWS::Logs::MetricFilter", {
        MetricTransformations: Match.arrayWith([
          Match.objectLike({ MetricName: metricName }),
        ]),
      });
    }
    compute.resourceCountIs("AWS::SQS::Queue", 3);
    compute.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 180,
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 10,
      Timeout: 30,
      Handler: "batch_submitter.handler",
      Environment: {
        Variables: Match.objectLike({
          PREPARE_JOB_DEFINITION: "shorts-mvp-prepare-test",
          RENDER_JOB_DEFINITION: "shorts-mvp-render-test",
          PROJECT_JOB_DEFINITION: "shorts-mvp-project-fargate-test",
          PROJECT_HEAVY_JOB_DEFINITION: "shorts-mvp-project-heavy-fargate-test",
          RERENDER_JOB_DEFINITION: "shorts-mvp-rerender-fargate-test",
          ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs-canary:1",
          ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
          SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitle-canary:2",
          SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
          UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles:3",
          UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified-template-subtitles",
        }),
      },
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "outbox_dispatcher.handler",
      Environment: {
        Variables: Match.objectLike({
          BATCH_SUBMITTER_FUNCTION_NAME: Match.anyValue(),
        }),
      },
    });
    compute.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
    });
  });

  it("requires the unified template target to be paired and revision-pinned", () => {
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesBatchQueueArn: "",
    })).toThrow("must be configured together");
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesJobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles",
    })).toThrow("exact revision-pinned ARN");
  });

  it("keeps the unified template Job Definition isolated", () => {
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesJobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitle-canary:2",
    })).toThrow("separate immutable Job Definition");
  });

  it("keeps one previous unified template revision trusted", () => {
    const previousDefinition =
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles:2";
    const { compute } = stacks("test", {
      unifiedTemplateSubtitlesPreviousJobDefinitionArn: previousDefinition,
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "batch_submitter.handler",
      Environment: {
        Variables: Match.objectLike({
          UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN:
            previousDefinition,
        }),
      },
    });
  });

  it("requires the previous unified revision to be pinned and distinct", () => {
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesPreviousJobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles",
    })).toThrow("exact revision-pinned ARN");
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesPreviousJobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles:3",
    })).toThrow("must differ from the primary target");
    expect(() => stacks("test", {
      unifiedTemplateSubtitlesPreviousJobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitle-canary:2",
    })).toThrow("separate immutable Job Definition");
  });

  it("requires the pinned unified target in production", () => {
    expect(() => stacks("production", {
      unifiedTemplateSubtitlesJobDefinitionArn: "",
      unifiedTemplateSubtitlesBatchQueueArn: "",
    })).toThrow("unifiedTemplateSubtitlesJobDefinitionArn");
  });

  it("does not create wildcard IAM actions", () => {
    const { compute } = stacks();
    const policies = compute.findResources("AWS::IAM::Policy");
    const serializedPolicies = JSON.stringify(policies);
    expect(serializedPolicies).toContain("lambda:InvokeFunction");
    expect(serializedPolicies).toContain("OutboxDispatcherFunction");
    expect(serializedPolicies).toContain("function:shorts-mvp-batch-submitter-test");
    expect(serializedPolicies).not.toContain("function/shorts-mvp-batch-submitter-test");
    for (const policy of Object.values(policies) as Array<Record<string, unknown>>) {
      expect(JSON.stringify(policy)).not.toContain('"Action":"*"');
    }
    compute.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["batch:SubmitJob"]),
            Effect: "Allow",
            Resource: "*",
          }),
        ]),
      },
    });
  });
});
