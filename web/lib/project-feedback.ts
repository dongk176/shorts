import { z } from "zod";

export const PROJECT_FEEDBACK_REWARD_SECONDS = 30 * 60;
export const PROJECT_FEEDBACK_REWARD_VALIDITY_DAYS = 90;
export const projectFeedbackPromptThresholds = [1, 3, 6, 9, 12] as const;

export const projectFeedbackDisappointmentReasons = [
  "result_quality",
  "editing_difficulty",
  "slow_generation",
  "confusing_usage",
  "error_occurred",
  "price_or_limits",
  "nothing_disappointing",
  "other",
] as const;

export type ProjectFeedbackDisappointmentReason =
  (typeof projectFeedbackDisappointmentReasons)[number];

export const projectFeedbackReasonLabels: Record<ProjectFeedbackDisappointmentReason, string> = {
  result_quality: "결과물의 품질",
  editing_difficulty: "원하는 부분을 편집하기 어려움",
  slow_generation: "생성 시간이 오래 걸림",
  confusing_usage: "사용 방법이 헷갈림",
  error_occurred: "오류가 발생함",
  price_or_limits: "가격 또는 이용 제한",
  nothing_disappointing: "아쉬운 점 없음",
  other: "기타",
};

export const projectFeedbackSubmissionSchema = z.object({
  requestId: z.string().uuid(),
  satisfactionRating: z.number().int().min(1).max(5),
  disappointmentReason: z.enum(projectFeedbackDisappointmentReasons),
  improvementText: z.string().trim().max(1000).optional().transform((value) => value || null),
});

export const projectFeedbackDeferralSchema = z.object({
  requestId: z.string().uuid(),
});

export type ProjectFeedbackPromptStatus = {
  eligible: boolean;
  submitted: boolean;
  permanentlyDismissed: boolean;
  completedProjectCount: number;
  promptCompletionCount: number | null;
  rewardSeconds: number;
  rewardValidityDays: number;
};

export function nextProjectFeedbackPromptThreshold(
  lastDeferredPromptCompletionCount: number | null,
  completedProjectCountAtDeferral: number | null = null,
): number | null {
  if (lastDeferredPromptCompletionCount === null) return projectFeedbackPromptThresholds[0];
  const completedFloor = Math.max(
    lastDeferredPromptCompletionCount,
    completedProjectCountAtDeferral ?? lastDeferredPromptCompletionCount,
  );
  return projectFeedbackPromptThresholds.find(
    (threshold) => threshold > completedFloor,
  ) ?? null;
}

export function resolveProjectFeedbackPromptStatus({
  completedProjectCount,
  lastDeferredPromptCompletionCount,
  completedProjectCountAtLastDeferral = null,
  submitted,
}: {
  completedProjectCount: number;
  lastDeferredPromptCompletionCount: number | null;
  completedProjectCountAtLastDeferral?: number | null;
  submitted: boolean;
}): ProjectFeedbackPromptStatus {
  const promptCompletionCount = submitted
    ? null
    : nextProjectFeedbackPromptThreshold(
        lastDeferredPromptCompletionCount,
        completedProjectCountAtLastDeferral,
      );
  const permanentlyDismissed = !submitted && promptCompletionCount === null;
  return {
    eligible: !submitted
      && !permanentlyDismissed
      && completedProjectCount >= Number(promptCompletionCount),
    submitted,
    permanentlyDismissed,
    completedProjectCount,
    promptCompletionCount,
    rewardSeconds: PROJECT_FEEDBACK_REWARD_SECONDS,
    rewardValidityDays: PROJECT_FEEDBACK_REWARD_VALIDITY_DAYS,
  };
}
