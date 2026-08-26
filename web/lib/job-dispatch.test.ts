import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elevenLabsTranscriptionDispatchTarget,
  legacyProjectDispatchTarget,
  sourceRangeDispatchTarget,
  subtitleTemplatesDispatchTarget,
  unifiedTemplateSubtitlesDispatchTarget,
} from "./job-dispatch";

afterEach(() => vi.unstubAllEnvs());

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

    expect(legacyProjectDispatchTarget()).toEqual({
      targetKey: "legacy_project",
      releaseId: "project-f8623974c7528ce9",
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/legacy:1",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/legacy",
    });
    expect(sourceRangeDispatchTarget()).toEqual({
      targetKey: "source_range",
      releaseId: "source-range-f8623974c7528ce9",
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/source-range:2",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/source-range",
    });
    expect(elevenLabsTranscriptionDispatchTarget()).toEqual({
      targetKey: "elevenlabs_transcription",
      releaseId: "elevenlabs-f8623974c7528ce9",
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/elevenlabs:3",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/elevenlabs",
    });
    expect(subtitleTemplatesDispatchTarget()).toEqual({
      targetKey: "subtitle_templates",
      releaseId: "subtitle-templates-f8623974c7528ce9",
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/subtitles:4",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/subtitles",
    });
    expect(unifiedTemplateSubtitlesDispatchTarget()).toEqual({
      targetKey: "unified_template_subtitles",
      releaseId: "unified-f28e1fe874c1-r4",
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/unified:5",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/unified",
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
});
