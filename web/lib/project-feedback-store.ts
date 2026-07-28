import type { Sql, TransactionSql } from "postgres";
import {
  resolveProjectFeedbackPromptStatus,
  type ProjectFeedbackPromptStatus,
} from "@/lib/project-feedback";
import { ONBOARDING_WELCOME_PRODUCT_CODE } from "@/lib/onboarding-welcome";

export async function getProjectFeedbackPromptStatus(
  db: Sql | TransactionSql,
  userId: string,
): Promise<ProjectFeedbackPromptStatus> {
  const rows = await db`
    select
      (
        select count(*)::integer
        from shorts_mvp.video_jobs
        where user_id=${userId}
          and not is_example
          and status='completed'
          and completed_at is not null
      ) as completed_project_count,
      exists (
        select 1
        from shorts_mvp.project_feedback_responses
        where user_id=${userId}
      ) as submitted,
      (
        select prompt_completion_count::integer
        from shorts_mvp.project_feedback_prompt_deferrals
        where user_id=${userId}
        order by created_at desc
        limit 1
      ) as last_deferred_prompt_completion_count,
      (
        select completed_project_count::integer
        from shorts_mvp.project_feedback_prompt_deferrals
        where user_id=${userId}
        order by created_at desc
        limit 1
      ) as completed_project_count_at_last_deferral,
      exists (
        select 1
        from shorts_mvp.usage_grants welcome_grant
        where welcome_grant.user_id=${userId}
          and welcome_grant.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
      ) as has_onboarding_welcome_grant,
      exists (
        select 1
        from shorts_mvp.billing_orders paid_order
        where paid_order.user_id=${userId}
          and paid_order.status='succeeded'
          and paid_order.amount_krw>0
      ) as has_payment_history
  `;
  const row = rows[0];
  const status = resolveProjectFeedbackPromptStatus({
    completedProjectCount: Number(row?.completedProjectCount || 0),
    lastDeferredPromptCompletionCount: row?.lastDeferredPromptCompletionCount == null
      ? null
      : Number(row.lastDeferredPromptCompletionCount),
    completedProjectCountAtLastDeferral: row?.completedProjectCountAtLastDeferral == null
      ? null
      : Number(row.completedProjectCountAtLastDeferral),
    submitted: Boolean(row?.submitted),
  });
  if (Boolean(row?.hasOnboardingWelcomeGrant) && !Boolean(row?.hasPaymentHistory)) {
    return {
      ...status,
      eligible: false,
      promptCompletionCount: null,
    };
  }
  return status;
}
