import { describe, expect, it } from "vitest";
import { latestJobDefinitionName } from "@/lib/aws";

describe("latestJobDefinitionName", () => {
  it("uses the latest active revision for a Batch ARN", () => {
    expect(latestJobDefinitionName(
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-short-production:2",
    )).toBe("shorts-mvp-short-production");
  });

  it("removes an explicit revision from a job definition name", () => {
    expect(latestJobDefinitionName("shorts-mvp-long-production:7"))
      .toBe("shorts-mvp-long-production");
  });

  it("keeps an unversioned job definition name", () => {
    expect(latestJobDefinitionName("shorts-mvp-short-production"))
      .toBe("shorts-mvp-short-production");
  });
});
