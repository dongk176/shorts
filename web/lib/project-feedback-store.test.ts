import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { getProjectFeedbackPromptStatus } from "./project-feedback-store";

describe("project feedback reward eligibility", () => {
  it("does not let a free onboarding project expand into the 30-minute reward", async () => {
    const db = vi.fn().mockResolvedValue([{
      completedProjectCount: 1,
      submitted: false,
      lastDeferredPromptCompletionCount: null,
      completedProjectCountAtLastDeferral: null,
      hasOnboardingWelcomeGrant: true,
      hasPaymentHistory: false,
    }]) as unknown as Sql;

    await expect(getProjectFeedbackPromptStatus(db, "user-free")).resolves.toMatchObject({
      eligible: false,
      completedProjectCount: 1,
      promptCompletionCount: null,
    });
  });

  it("restores normal feedback eligibility after a successful payment", async () => {
    const db = vi.fn().mockResolvedValue([{
      completedProjectCount: 1,
      submitted: false,
      lastDeferredPromptCompletionCount: null,
      completedProjectCountAtLastDeferral: null,
      hasOnboardingWelcomeGrant: true,
      hasPaymentHistory: true,
    }]) as unknown as Sql;

    await expect(getProjectFeedbackPromptStatus(db, "user-paid")).resolves.toMatchObject({
      eligible: true,
      completedProjectCount: 1,
      promptCompletionCount: 1,
    });
  });
});
