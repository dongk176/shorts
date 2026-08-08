import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elevenLabsTranscriptionDispatchTarget,
  sourceRangeDispatchTarget,
  subtitleTemplatesDispatchTarget,
} from "./job-dispatch";

afterEach(() => vi.unstubAllEnvs());

describe("project dispatch target", () => {
  it("returns the exact allowlisted source-range ARNs", () => {
    vi.stubEnv("SOURCE_RANGE_JOB_DEFINITION_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-definition/source-range:1");
    vi.stubEnv("SOURCE_RANGE_BATCH_QUEUE_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-queue/source-range");

    expect(sourceRangeDispatchTarget().jobDefinitionArn).toMatch(/source-range:1$/);
    expect(sourceRangeDispatchTarget().jobQueueArn).toMatch(/source-range$/);
  });

  it("fails closed for names and untrusted ARNs", () => {
    vi.stubEnv("SOURCE_RANGE_JOB_DEFINITION_ARN", "shorts-mvp-source-range-v1-production");
    vi.stubEnv("SOURCE_RANGE_BATCH_QUEUE_ARN", "source-range-queue");
    expect(() => sourceRangeDispatchTarget()).toThrow("정확한 AWS ARN");
  });

  it("keeps the ElevenLabs candidate on its exact immutable target", () => {
    vi.stubEnv(
      "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/elevenlabs-canary:3",
    );
    vi.stubEnv(
      "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs-canary",
    );

    expect(elevenLabsTranscriptionDispatchTarget()).toEqual({
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/elevenlabs-canary:3",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs-canary",
    });
  });

  it("keeps subtitle jobs on their own immutable candidate target", () => {
    vi.stubEnv(
      "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN",
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitle-templates:4",
    );
    vi.stubEnv(
      "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN",
      "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs-canary",
    );

    expect(subtitleTemplatesDispatchTarget()).toEqual({
      jobDefinitionArn:
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitle-templates:4",
      jobQueueArn:
        "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs-canary",
    });
  });
});
