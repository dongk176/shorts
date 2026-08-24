import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { getProjectFeedbackPromptStatus } from "./project-feedback-store";

describe("project feedback reward eligibility", () => {
  it("allows feedback after a free onboarding project", async () => {
    const db = vi.fn().mockResolvedValue([{
      completedProjectCount: 1,
      submitted: false,
      lastDeferredPromptCompletionCount: null,
      completedProjectCountAtLastDeferral: null,
    }]) as unknown as Sql;

    await expect(getProjectFeedbackPromptStatus(db, "user-free")).resolves.toMatchObject({
      eligible: true,
      completedProjectCount: 1,
      promptCompletionCount: 1,
    });
  });

  it("keeps paid users eligible under the same completion threshold", async () => {
    const db = vi.fn().mockResolvedValue([{
      completedProjectCount: 1,
      submitted: false,
      lastDeferredPromptCompletionCount: null,
      completedProjectCountAtLastDeferral: null,
    }]) as unknown as Sql;

    await expect(getProjectFeedbackPromptStatus(db, "user-paid")).resolves.toMatchObject({
      eligible: true,
      completedProjectCount: 1,
      promptCompletionCount: 1,
    });
  });
});
