import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDispatchTarget } from "./job-dispatch";

afterEach(() => vi.unstubAllEnvs());

describe("project dispatch target", () => {
  it("returns exact allowlisted legacy and range ARNs", () => {
    vi.stubEnv("LEGACY_PROJECT_JOB_DEFINITION_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-definition/legacy:27");
    vi.stubEnv("LEGACY_PROJECT_BATCH_QUEUE_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-queue/legacy");
    vi.stubEnv("SOURCE_RANGE_JOB_DEFINITION_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-definition/source-range:1");
    vi.stubEnv("SOURCE_RANGE_BATCH_QUEUE_ARN", "arn:aws:batch:ap-northeast-2:181651591905:job-queue/source-range");

    expect(projectDispatchTarget(false).jobDefinitionArn).toMatch(/legacy:27$/);
    expect(projectDispatchTarget(true).jobQueueArn).toMatch(/source-range$/);
  });

  it("fails closed for names and untrusted ARNs", () => {
    vi.stubEnv("LEGACY_PROJECT_JOB_DEFINITION_ARN", "shorts-mvp-project-heavy-fargate-production");
    vi.stubEnv("LEGACY_PROJECT_BATCH_QUEUE_ARN", "legacy-queue");
    expect(() => projectDispatchTarget(false)).toThrow("정확한 AWS ARN");
  });
});
