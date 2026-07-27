import { describe, expect, it } from "vitest";
import {
  nextProjectFeedbackPromptThreshold,
  resolveProjectFeedbackPromptStatus,
} from "@/lib/project-feedback";

describe("project feedback prompt schedule", () => {
  it("advances through 1, 3, 6, 9, and 12 completed projects", () => {
    expect(nextProjectFeedbackPromptThreshold(null)).toBe(1);
    expect(nextProjectFeedbackPromptThreshold(1)).toBe(3);
    expect(nextProjectFeedbackPromptThreshold(3)).toBe(6);
    expect(nextProjectFeedbackPromptThreshold(6)).toBe(9);
    expect(nextProjectFeedbackPromptThreshold(9)).toBe(12);
    expect(nextProjectFeedbackPromptThreshold(12)).toBeNull();
  });

  it("skips retry thresholds that were already passed before a deferral", () => {
    expect(nextProjectFeedbackPromptThreshold(1, 5)).toBe(6);
    expect(nextProjectFeedbackPromptThreshold(1, 10)).toBe(12);
    expect(nextProjectFeedbackPromptThreshold(1, 12)).toBeNull();
  });

  it("only becomes eligible after the next threshold is reached", () => {
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 0,
      lastDeferredPromptCompletionCount: null,
      submitted: false,
    }).eligible).toBe(false);
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 1,
      lastDeferredPromptCompletionCount: null,
      submitted: false,
    }).eligible).toBe(true);
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 2,
      lastDeferredPromptCompletionCount: 1,
      submitted: false,
    }).eligible).toBe(false);
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 3,
      lastDeferredPromptCompletionCount: 1,
      submitted: false,
    }).eligible).toBe(true);
  });

  it("stays hidden after submission or the deferral at project 12", () => {
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 100,
      lastDeferredPromptCompletionCount: 9,
      submitted: true,
    })).toMatchObject({ eligible: false, submitted: true });
    expect(resolveProjectFeedbackPromptStatus({
      completedProjectCount: 12,
      lastDeferredPromptCompletionCount: 12,
      submitted: false,
    })).toMatchObject({ eligible: false, permanentlyDismissed: true });
  });
});
