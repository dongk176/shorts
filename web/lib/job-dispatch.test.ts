import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elevenLabsTranscriptionDispatchTarget,
  legacyProjectDispatchTarget,
  sourceRangeDispatchTarget,
  subtitleTemplatesDispatchTarget,
  unifiedTemplateSubtitlesDispatchTarget,
} from "./job-dispatch";

afterEach(() => vi.unstubAllEnvs());

const workerSourceGitSha = "a".repeat(40);
const workerImageDigest = `sha256:${"b".repeat(64)}`;

function stubProvenance(prefix: string) {
  vi.stubEnv(`${prefix}_WORKER_SOURCE_GIT_SHA`, workerSourceGitSha);
  vi.stubEnv(`${prefix}_WORKER_IMAGE_DIGEST`, workerImageDigest);
}

describe("project dispatch target", () => {
  it("stores logical releases and the current exact pair for rollback compatibility", () => {
    vi.stubEnv("LEGACY_PROJECT_BATCH_TARGET_RELEASE_ID", "project-f8623974c7528ce9");
    vi.stubEnv(
      "LEGACY_PROJECT_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy:1",
    );
    vi.stubEnv(
      "LEGACY_PROJECT_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy",
    );
    vi.stubEnv("SOURCE_RANGE_BATCH_TARGET_RELEASE_ID", "source-range-f8623974c7528ce9");
    vi.stubEnv(
      "SOURCE_RANGE_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/source-range:2",
    );
    vi.stubEnv(
      "SOURCE_RANGE_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/source-range",
    );
    vi.stubEnv(
      "ELEVENLABS_TRANSCRIPTION_BATCH_TARGET_RELEASE_ID",
      "elevenlabs-f8623974c7528ce9",
    );
    vi.stubEnv(
      "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs:3",
    );
    vi.stubEnv(
      "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs",
    );
    vi.stubEnv(
      "SUBTITLE_TEMPLATES_BATCH_TARGET_RELEASE_ID",
      "subtitle-templates-f8623974c7528ce9",
    );
    vi.stubEnv(
      "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitles:4",
    );
    vi.stubEnv(
      "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/subtitles",
    );
    vi.stubEnv(
      "UNIFIED_TEMPLATE_SUBTITLES_BATCH_TARGET_RELEASE_ID",
      "unified-f28e1fe874c1-r4",
    );
    vi.stubEnv(
      "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified:5",
    );
    vi.stubEnv(
      "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified",
    );
    for (const prefix of [
      "LEGACY_PROJECT",
      "SOURCE_RANGE",
      "ELEVENLABS_TRANSCRIPTION",
      "SUBTITLE_TEMPLATES",
      "UNIFIED_TEMPLATE_SUBTITLES",
    ]) stubProvenance(prefix);

    expect(legacyProjectDispatchTarget()).toEqual({
      targetKey: "legacy_project",
      releaseId: "project-f8623974c7528ce9",
      workerSourceGitSha,
      workerImageDigest,
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy:1",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy",
      v4Capability: null,
    });
    expect(sourceRangeDispatchTarget()).toEqual({
      targetKey: "source_range",
      releaseId: "source-range-f8623974c7528ce9",
      workerSourceGitSha,
      workerImageDigest,
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/source-range:2",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/source-range",
      v4Capability: null,
    });
    expect(elevenLabsTranscriptionDispatchTarget()).toEqual({
      targetKey: "elevenlabs_transcription",
      releaseId: "elevenlabs-f8623974c7528ce9",
      workerSourceGitSha,
      workerImageDigest,
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs:3",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs",
      v4Capability: null,
    });
    expect(subtitleTemplatesDispatchTarget()).toEqual({
      targetKey: "subtitle_templates",
      releaseId: "subtitle-templates-f8623974c7528ce9",
      workerSourceGitSha,
      workerImageDigest,
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitles:4",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/subtitles",
      v4Capability: null,
    });
    expect(unifiedTemplateSubtitlesDispatchTarget()).toEqual({
      targetKey: "unified_template_subtitles",
      releaseId: "unified-f28e1fe874c1-r4",
      workerSourceGitSha,
      workerImageDigest,
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified:5",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified",
      v4Capability: null,
    });
  });

  it("fails closed for a missing or malformed release id", () => {
    vi.stubEnv("SOURCE_RANGE_BATCH_TARGET_RELEASE_ID", "");
    expect(() => sourceRangeDispatchTarget()).toThrow("정확한 배포 ID");

    vi.stubEnv("SOURCE_RANGE_BATCH_TARGET_RELEASE_ID", "arn:aws:batch:unsafe");
    expect(() => sourceRangeDispatchTarget()).toThrow("정확한 배포 ID");
  });

  it("fails closed when the rollback pair is missing or mutable", () => {
    vi.stubEnv("LEGACY_PROJECT_BATCH_TARGET_RELEASE_ID", "legacy-r1");
    stubProvenance("LEGACY_PROJECT");
    vi.stubEnv("LEGACY_PROJECT_JOB_DEFINITION_ARN", "legacy:1");
    vi.stubEnv(
      "LEGACY_PROJECT_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy",
    );
    expect(() => legacyProjectDispatchTarget()).toThrow("정확한 AWS ARN");

    vi.stubEnv(
      "LEGACY_PROJECT_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy:1",
    );
    vi.stubEnv("LEGACY_PROJECT_BATCH_QUEUE_ARN", "legacy");
    expect(() => legacyProjectDispatchTarget()).toThrow("정확한 AWS ARN");
  });

  it("accepts only a complete exact v4 capability triple", () => {
    vi.stubEnv("LEGACY_PROJECT_BATCH_TARGET_RELEASE_ID", "legacy-r1");
    vi.stubEnv(
      "LEGACY_PROJECT_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy:1",
    );
    vi.stubEnv(
      "LEGACY_PROJECT_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy",
    );
    stubProvenance("LEGACY_PROJECT");
    vi.stubEnv("LEGACY_PROJECT_RENDER_SPEC_VERSION", "4");
    vi.stubEnv("LEGACY_PROJECT_CAPTION_RENDER_SPEC_VERSION", "4");
    vi.stubEnv("LEGACY_PROJECT_FONT_MANIFEST_SHA256", "c".repeat(64));

    expect(legacyProjectDispatchTarget().v4Capability).toEqual({
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256: "c".repeat(64),
    });

    vi.stubEnv("LEGACY_PROJECT_CAPTION_RENDER_SPEC_VERSION", "");
    expect(() => legacyProjectDispatchTarget()).toThrow("완전한 4/4/hash");
  });
});
