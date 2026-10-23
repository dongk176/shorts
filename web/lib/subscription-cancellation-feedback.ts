import type { Sql, TransactionSql } from "postgres";
import { cancellationFeedbackSchema, type CancellationFeedback } from "@/lib/subscription-cancellation";

// Called inside the cancellation transaction: answers represent confirmed requests,
// never an abandoned survey. The unique key makes retries of one cancellation safe.
export async function saveCancellationFeedback(db: Sql | TransactionSql, userId: string, subscriptionId: string, input: CancellationFeedback) {
  const feedback = cancellationFeedbackSchema.parse(input);
  const rows = await db`
    insert into shorts_mvp.subscription_cancellation_feedback
      (user_id,subscription_id,payment_provider,plan_code,billing_cycle,reason,detail,message,
       alternative_service,alternative_undecided,canceled_at,access_until)
    select user_id,id,payment_provider,plan_code,billing_cycle,${feedback.reason},${feedback.detail || null},${feedback.message || null},
      ${feedback.alternativeService || null},${feedback.alternativeUndecided},canceled_at,current_period_end
    from shorts_mvp.user_subscriptions
    where id=${subscriptionId} and user_id=${userId} and cancel_at_period_end and canceled_at is not null
    on conflict (subscription_id,canceled_at) do update set subscription_id=excluded.subscription_id
    returning id
  `;
  if (!rows.length) throw new Error("Cancellation feedback requires a confirmed subscription cancellation");
}
