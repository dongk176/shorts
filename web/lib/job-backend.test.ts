import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialJobBackend } from "@/lib/job-backend";

describe("initial job backend", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to AWS Batch", () => {
    vi.stubEnv("VIDEO_JOB_BACKEND", "");
    expect(getInitialJobBackend()).toBe("aws_batch");
  });

  it("uses the Mac pull queue only when explicitly enabled", () => {
    vi.stubEnv("VIDEO_JOB_BACKEND", "mac_pull");
    expect(getInitialJobBackend()).toBe("mac_pull");
  });
});
