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

function testProjectTargetRegistry(environment: string) {
  return {
    version: 1,
    environment,
    lanes: {
      legacy_project: {
        schedulingMode: "fair_share",
        current: {
          releaseId: "legacy-project-r1",
          workerSourceGitSha: "a".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy-project-aaaaaaa:1",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy-project",
        },
        previous: null,
      },
      source_range: {
        schedulingMode: "fair_share",
        current: {
          releaseId: "source-range-r1",
          workerSourceGitSha: "a".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/source-range-aaaaaaa:1",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/source-range",
        },
        previous: null,
      },
      elevenlabs_transcription: {
        schedulingMode: "fair_share",
        current: {
          releaseId: "elevenlabs-r1",
          workerSourceGitSha: "a".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs-canary-aaaaaaa:1",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
        },
        previous: null,
      },
      subtitle_templates: {
        schedulingMode: "fair_share",
        current: {
          releaseId: "subtitle-templates-r2",
          workerSourceGitSha: "a".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitle-canary-aaaaaaa:2",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs-canary",
        },
        previous: null,
      },
      unified_template_subtitles: {
        schedulingMode: "fifo",
        current: {
          releaseId: "unified-r3",
          workerSourceGitSha: "a".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"a".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles-aaaaaaa:3",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified-template-subtitles",
        },
        previous: {
          releaseId: "unified-r2",
          workerSourceGitSha: "b".repeat(40),
          imageUri: `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/releases@sha256:${"b".repeat(64)}`,
          jobDefinitionArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles-bbbbbbb:2",
          jobQueueArn:
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified-template-subtitles",
          submitAsReleaseId: "unified-r3",
        },
      },
    },
  };
}

const exactRegistrarPassRoleArns = JSON.stringify([
  "arn:aws:iam::123456789012:role/shorts-mvp-editor-test-execution",
  "arn:aws:iam::123456789012:role/shorts-mvp-editor-test-task",
  "arn:aws:iam::123456789012:role/shorts-production-worker-execution",
  "arn:aws:iam::123456789012:role/shorts-production-worker-task",
]);

function stacks(
  environment = "test",
  contextOverrides: Record<string, string> = {},
) {
  const app = new cdk.App({ context: {
    vercelTeamSlug: "team",
    vercelProjectName: "shorts",
    workerImageTag: "test-worker-image",
    legacyRerenderImageTag: "legacy-worker-image",
    githubRepositoryId: "1234567",
    githubRepositoryOwnerId: "7654321",
    [`editorStableRerenderJobDefinitionArn:${environment}`]:
      `arn:aws:batch:ap-northeast-2:123456789012:job-definition/shorts-mvp-rerender-fargate-${environment}:7`,
    projectTargetRegistryJson: JSON.stringify(
      testProjectTargetRegistry(environment),
    ),
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

  it("disables editor release OIDC trust unless the exact Stage B ref is supplied", () => {
    const { editorCanary } = stacks("production");
    const roles = editorCanary.findResources("AWS::IAM::Role");
    const editorReleaseRole = Object.entries(roles).find(([logicalId]) => (
      logicalId.startsWith("EditorReleaseBuildRole")
    ))?.[1];
    const condition = editorReleaseRole?.Properties?.AssumeRolePolicyDocument
      ?.Statement?.[0]?.Condition?.StringEquals;
    const subject = condition
      ?.["token.actions.githubusercontent.com:sub"];

    expect(condition?.["token.actions.githubusercontent.com:aud"])
      .toBe("sts.amazonaws.com");
    expect(subject).toBe(
      "repo:dongk176/shorts:ref:refs/tags/__disabled_editor_release__",
    );
  });

  it("splits the exact protected Stage B tag between build and approval roles", () => {
    const { editorCanary } = stacks("production", {
      githubEditorReleaseRef:
        "refs/tags/editor-v4-render-parity-20260827-3",
      editorReleaseRegistrarPassRoleArns: exactRegistrarPassRoleArns,
    });
    const roles = editorCanary.findResources("AWS::IAM::Role");
    const buildRole = Object.entries(roles).find(([logicalId]) => (
      logicalId.startsWith("EditorReleaseBuildRole")
    ))?.[1];
    const verifierRole = Object.entries(roles).find(([logicalId]) => (
      logicalId.startsWith("EditorReleaseVerifierRole")
    ))?.[1];
    const buildCondition = buildRole?.Properties?.AssumeRolePolicyDocument
      ?.Statement?.[0]?.Condition;
    const verifierCondition = verifierRole?.Properties?.AssumeRolePolicyDocument
      ?.Statement?.[0]?.Condition;

    expect(buildCondition?.StringLike).toBeUndefined();
    expect(buildCondition?.StringEquals?.[
      "token.actions.githubusercontent.com:sub"
    ]).toBe(
      "repo:dongk176/shorts:ref:refs/tags/editor-v4-render-parity-20260827-3",
    );
    expect(verifierCondition?.StringLike).toBeUndefined();
    expect(verifierCondition?.StringEquals?.[
      "token.actions.githubusercontent.com:sub"
    ]).toBe("repo:dongk176/shorts:environment:editor-v4-release-approval");
    expect(verifierCondition?.StringEquals?.[
      "token.actions.githubusercontent.com:workflow"
    ]).toBe("Verify editor release candidate");
  });

  it("lets only the verifier read isolated evidence and invoke the registrar", () => {
    const { editorCanary } = stacks("production", {
      githubEditorReleaseRef:
        "refs/tags/editor-v4-render-parity-20260827-3",
      editorReleaseRegistrarPassRoleArns: exactRegistrarPassRoleArns,
    });
    const template = editorCanary.toJSON();
    const policies = template.Resources as Record<string, {
      Properties?: { PolicyDocument?: { Statement?: unknown[] } };
    }>;
    const buildPolicy = JSON.stringify(Object.entries(policies)
      .filter(([logicalId]) => logicalId.startsWith("EditorReleaseBuildRole")));
    const verifierPolicy = JSON.stringify(Object.entries(policies)
      .filter(([logicalId]) => logicalId.startsWith("EditorReleaseVerifierRole")));
    const registrarPolicy = JSON.stringify(Object.entries(policies)
      .filter(([logicalId]) => logicalId.startsWith("EditorReleaseRegistrarRole")));

    expect(verifierPolicy).toContain('"s3:GetObject"');
    expect(verifierPolicy).toContain('"s3:GetObjectVersion"');
    expect(verifierPolicy).toContain("editor-release-probes/*");
    expect(verifierPolicy).toContain('"lambda:InvokeFunction"');
    expect(verifierPolicy).not.toContain('"batch:SubmitJob"');
    expect(verifierPolicy).not.toContain('"batch:RegisterJobDefinition"');
    expect(verifierPolicy).not.toContain('"s3:PutObject"');
    expect(verifierPolicy).not.toContain('"iam:PassRole"');
    expect(registrarPolicy).toContain('"batch:SubmitJob"');
    expect(registrarPolicy).toContain('"batch:RegisterJobDefinition"');
    expect(registrarPolicy).toContain('"iam:PassRole"');
    expect(registrarPolicy).toContain("shorts-production-worker-task");
    expect(registrarPolicy).toContain("shorts-mvp-editor-test-task");
    expect(buildPolicy).not.toContain('"s3:GetObject"');
    expect(buildPolicy).not.toContain('"s3:PutObject"');
    expect(buildPolicy).not.toContain('"batch:SubmitJob"');
    expect(buildPolicy).not.toContain('"lambda:InvokeFunction"');
  });

  it("rejects every unapproved editor release OIDC ref", () => {
    expect(() => stacks("production", {
      githubEditorReleaseRef: "refs/heads/codex/*",
    })).toThrow(/exact Stage B ref or disabled sentinel/);
  });

  it("requires unique exact PassRole ARNs when the protected tag is enabled", () => {
    expect(() => stacks("production", {
      githubEditorReleaseRef:
        "refs/tags/editor-v4-render-parity-20260827-3",
    })).toThrow(/editorReleaseRegistrarPassRoleArns context is required/);
    expect(() => stacks("production", {
      githubEditorReleaseRef:
        "refs/tags/editor-v4-render-parity-20260827-3",
      editorReleaseRegistrarPassRoleArns: JSON.stringify([
        "arn:aws:iam::123456789012:role/shorts-*",
        "arn:aws:iam::123456789012:role/shorts-task",
      ]),
    })).toThrow(/unique exact role ARNs/);
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
    const rerenderDefinitionArn =
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/shorts-mvp-rerender-fargate-test:7";

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
          PROJECT_BATCH_QUEUE: Match.anyValue(),
          EDITOR_STABLE_BATCH_QUEUE: Match.anyValue(),
          EDITOR_CANARY_BATCH_QUEUE: {
            "Fn::GetAtt": ["EditorCanaryQueue", "JobQueueArn"],
          },
          EDITOR_TEST_TEMPLATE_JOB_DEFINITION:
            "shorts-mvp-editor-test-template",
          RERENDER_JOB_DEFINITION: rerenderDefinitionArn,
        }),
      },
    });
    const submitter = Object.values(
      editorCanary.toJSON().Resources as Record<string, any>,
    ).find((resource: any) => (
      resource.Type === "AWS::Lambda::Function"
      && resource.Properties?.Handler === "batch_submitter.handler"
    )) as any;
    const targetEnvironment = submitter.Properties.Environment.Variables;
    expect(targetEnvironment.PROJECT_BATCH_QUEUE).toEqual(
      targetEnvironment.EDITOR_STABLE_BATCH_QUEUE,
    );
    expect(JSON.stringify(targetEnvironment.PROJECT_BATCH_QUEUE)).toContain(
      "job-queue/shorts-mvp-project-fargate-test",
    );
    expect(targetEnvironment.RERENDER_JOB_DEFINITION).toBe(
      rerenderDefinitionArn,
    );
    editorCanary.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "editor_outbox_dispatcher.handler",
    });
  });

  it("rejects an unpinned editor rerender Job Definition target", () => {
    expect(() => stacks("test", {
      "editorStableRerenderJobDefinitionArn:test":
        "shorts-mvp-rerender-fargate-test",
    })).toThrow(
      "editorStableRerenderJobDefinitionArn:test must be the revision-pinned test rerender Job Definition ARN",
    );
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
    compute.resourceCountIs("AWS::Logs::MetricFilter", 29);
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
      "BatchSubmitterFailure",
      "BatchTargetTrustRejected",
      "BatchTargetUnknownRelease",
      "QueuedWithoutBatchId",
      "ProjectDispatchHealthCheckFailed",
      "BatchSubmissionReconciliationRequired",
    ]) {
      compute.hasResourceProperties("AWS::Logs::MetricFilter", {
        MetricTransformations: Match.arrayWith([
          Match.objectLike({ MetricName: metricName }),
        ]),
      });
    }
    compute.resourceCountIs("AWS::SQS::Queue", 3);
    compute.resourceCountIs("AWS::CloudWatch::Alarm", 8);
    for (const alarmName of [
      "shorts-mvp-test-batch-submitter-failure",
      "shorts-mvp-test-batch-target-trust-rejected",
      "shorts-mvp-test-batch-target-unknown-release",
      "shorts-mvp-test-queued-without-batch-id",
      "shorts-mvp-test-project-dispatch-health-check-failed",
      "shorts-mvp-test-batch-submission-reconciliation-required",
      "shorts-mvp-test-batch-submitter-lambda-error",
      "shorts-mvp-test-work-dispatch-dlq",
    ]) {
      compute.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        EvaluationPeriods: 1,
        Threshold: 1,
        TreatMissingData: "notBreaching",
      });
    }
    compute.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 180,
    });
    compute.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 10,
      Timeout: 30,
      Handler: "batch_submitter.handler",
      Environment: {
        Variables: Match.objectLike({
          PREPARE_JOB_DEFINITION: {
            "Fn::GetAtt": ["PrepareJobDefinition", "JobDefinitionArn"],
          },
          RENDER_JOB_DEFINITION: {
            "Fn::GetAtt": ["RenderJobDefinition", "JobDefinitionArn"],
          },
          PROJECT_JOB_DEFINITION: "shorts-mvp-project-fargate-test",
          PROJECT_HEAVY_JOB_DEFINITION:
            "shorts-mvp-project-heavy-fargate-test",
          RERENDER_JOB_DEFINITION: {
            "Fn::GetAtt": [
              "RerenderFargateJobDefinition",
              "JobDefinitionArn",
            ],
          },
          PROJECT_TARGET_REGISTRY_PATH:
            "/var/task/production-project-targets.json",
          PROJECT_TARGET_REGISTRY_REQUIRED: "false",
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

  it("packages each control-plane Lambda as its handler plus common only", () => {
    const { compute, editorCanary } = stacks();
    const functions = Object.values(
      compute.findResources("AWS::Lambda::Function"),
    ) as Array<{ Properties?: { Handler?: string; Code?: unknown } }>;
    const codeByHandler = Object.fromEntries(functions.map((resource) => [
      resource.Properties?.Handler,
      resource.Properties?.Code,
    ]));
    for (const handler of [
      "cleanup.handler",
      "batch_state.handler",
      "outbox_dispatcher.handler",
      "batch_submitter.handler",
      "state_writer.handler",
    ]) {
      expect(codeByHandler[handler]).toBeDefined();
    }
    expect(codeByHandler["cleanup.handler"]).not.toEqual(
      codeByHandler["batch_submitter.handler"],
    );
    expect(codeByHandler["batch_state.handler"]).not.toEqual(
      codeByHandler["state_writer.handler"],
    );
    const editorFunctions = Object.values(
      editorCanary.findResources("AWS::Lambda::Function"),
    ) as Array<{ Properties?: { Handler?: string; Code?: unknown } }>;
    const editorSubmitter = editorFunctions.find(
      (resource) => resource.Properties?.Handler === "batch_submitter.handler",
    );
    expect(editorSubmitter?.Properties?.Code).not.toEqual(
      codeByHandler["batch_submitter.handler"],
    );
  });

  it("requires every registry target to be revision-pinned and isolated", () => {
    const mutable = testProjectTargetRegistry("test");
    mutable.lanes.unified_template_subtitles.current.jobDefinitionArn =
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified-template-subtitles";
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(mutable),
    })).toThrow("revision-pinned");

    const shared = testProjectTargetRegistry("test");
    shared.lanes.unified_template_subtitles.current.jobDefinitionArn =
      shared.lanes.subtitle_templates.current.jobDefinitionArn;
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(shared),
    })).toThrow("must be isolated");

    const shortSource = testProjectTargetRegistry("test");
    shortSource.lanes.legacy_project.current.workerSourceGitSha = "a".repeat(12);
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(shortSource),
    })).toThrow("workerSourceGitSha");

    const foreignImage = testProjectTargetRegistry("test");
    foreignImage.lanes.legacy_project.current.imageUri = foreignImage
      .lanes.legacy_project.current.imageUri.replace(
        "123456789012",
        "999999999999",
      );
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(foreignImage),
    })).toThrow("worker image account/region mismatch");

    const missingSourceIdentity = testProjectTargetRegistry("test");
    missingSourceIdentity.lanes.legacy_project.current.jobDefinitionArn =
      missingSourceIdentity.lanes.legacy_project.current.jobDefinitionArn
        .replace("-aaaaaaa", "");
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(missingSourceIdentity),
    })).toThrow("worker source identity");
  });

  it("injects one immutable registry asset while preserving exact rollback targets", () => {
    const registry = testProjectTargetRegistry("test");
    const { compute } = stacks("test");
    const functions = Object.values(
      compute.findResources("AWS::Lambda::Function"),
    ) as Array<{
      Properties?: {
        Handler?: string;
        Environment?: { Variables?: Record<string, unknown> };
      };
    }>;
    const submitter = functions.find(
      (resource) => resource.Properties?.Handler === "batch_submitter.handler",
    );
    const variables = submitter?.Properties?.Environment?.Variables || {};
    expect(variables.PROJECT_TARGET_REGISTRY_PATH).toBe(
      "/var/task/production-project-targets.json",
    );
    expect(variables.PROJECT_TARGET_REGISTRY_JSON).toBeUndefined();
    const targetPrefixes = {
      LEGACY_PROJECT: "legacy_project",
      SOURCE_RANGE: "source_range",
      ELEVENLABS_TRANSCRIPTION: "elevenlabs_transcription",
      SUBTITLE_TEMPLATES: "subtitle_templates",
      UNIFIED_TEMPLATE_SUBTITLES: "unified_template_subtitles",
    } as const;
    for (const prefix of Object.keys(targetPrefixes) as Array<
      keyof typeof targetPrefixes
    >) {
      const laneKey = targetPrefixes[prefix];
      const lane = registry.lanes[laneKey];
      expect(variables[`${prefix}_JOB_DEFINITION_ARN`]).toBe(
        lane.current.jobDefinitionArn,
      );
      expect(variables[`${prefix}_BATCH_QUEUE_ARN`]).toBe(
        lane.current.jobQueueArn,
      );
      expect(variables[`${prefix}_BATCH_TARGET_RELEASE_ID`]).toBeUndefined();
    }
    expect(
      variables.UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN,
    ).toBe(
      registry.lanes.unified_template_subtitles.previous.jobDefinitionArn,
    );
  });

  it("requires previous releases to be distinct and submit as current", () => {
    const sameRelease = testProjectTargetRegistry("test");
    sameRelease.lanes.unified_template_subtitles.previous.releaseId =
      sameRelease.lanes.unified_template_subtitles.current.releaseId;
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(sameRelease),
    })).toThrow("release IDs must be unique");

    const wrongSubmitTarget = testProjectTargetRegistry("test");
    wrongSubmitTarget.lanes.unified_template_subtitles.previous
      .submitAsReleaseId = "unified-other";
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(wrongSubmitTarget),
    })).toThrow("must stay in its lane");

    const selfExecuting = testProjectTargetRegistry("test");
    delete (selfExecuting.lanes.unified_template_subtitles.previous as {
      submitAsReleaseId?: string;
    }).submitAsReleaseId;
    expect(() => stacks("test", {
      projectTargetRegistryJson: JSON.stringify(selfExecuting),
    })).not.toThrow();
  });

  it("requires the committed target registry in production", () => {
    expect(() => stacks("production", {
      projectTargetRegistryJson: "",
    })).toThrow("projectTargetRegistryJson context is required");

    const { compute } = stacks("production");
    compute.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "batch_submitter.handler",
      Environment: {
        Variables: Match.objectLike({
          PROJECT_TARGET_REGISTRY_REQUIRED: "true",
        }),
      },
    });
    const functions = Object.values(
      compute.findResources("AWS::Lambda::Function"),
    ) as Array<{
      Properties?: {
        Handler?: string;
        Environment?: { Variables?: Record<string, unknown> };
      };
    }>;
    const submitter = functions.find(
      (resource) => resource.Properties?.Handler === "batch_submitter.handler",
    );
    const variables = submitter?.Properties?.Environment?.Variables || {};
    const environmentBytes = Object.entries(variables).reduce(
      (total, [name, value]) => total
        + Buffer.byteLength(name, "utf8")
        + Buffer.byteLength(
          typeof value === "string" ? value : JSON.stringify(value),
          "utf8",
        ),
      0,
    );
    expect(environmentBytes).toBeLessThanOrEqual(3500);
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
