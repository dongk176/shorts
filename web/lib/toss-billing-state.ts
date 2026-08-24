import type { Sql } from "postgres";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import type { MvpSession } from "@/lib/session";
import { loadTossBillingRuntimeState } from "@/lib/toss-billing-runtime";
import { TOSS_PLAN_CATALOG, classifyTossSubscriptionChange, quoteImmediateTossChange, tossPlan, type TossPlanCode } from "@/lib/toss-subscription";
import { getUsageSnapshot } from "@/lib/usage";

type StateSubscriptionRow = {
  id: string;
  planCode: TossPlanCode;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextQuotaAt: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanCode: TossPlanCode | null;
  scheduledChangeEffectiveAt: Date | null;
  cardNumberMasked: string | null;
  cardLast4: string | null;
  issuerCode: string | null;
};

export function publicTossCatalog() {
  return TOSS_PLAN_CATALOG.map((plan) => ({ ...plan }));
}

export async function getTossBillingState(input: {
  userId: string;
  session: MvpSession & { userId: string };
  db?: Sql;
}) {
  const db = input.db ?? getDb();
  await assertPersistedTossBillingCustomer(input.userId, db);
  const [rows, usage, runtime] = await Promise.all([
    db`
      select s.id,s.plan_code,s.status,s.current_period_start,s.current_period_end,
        s.next_quota_at,s.cancel_at_period_end,s.scheduled_plan_code,
        s.scheduled_change_effective_at,p.card_number_masked,p.card_last4,p.issuer_code
      from shorts_mvp.user_subscriptions s
      left join shorts_mvp.billing_payment_methods p on p.id=s.payment_method_id
      where s.user_id=${input.userId} and s.payment_provider='toss'
        and s.status in ('pending','trialing','active','past_due')
      order by s.created_at desc
      limit 1
    `,
    getUsageSnapshot(db, input.session),
    loadTossBillingRuntimeState(db),
  ]);
  const subscription = rows[0] as StateSubscriptionRow | undefined;
  const catalog = publicTossCatalog();
  const paymentRestrictions = {
    hanaCardAvailable: runtime.effective.hanaCard,
  };
  if (!subscription) {
    return { subscription: null, usage, catalog, paymentRestrictions };
  }
  const actions = catalog.map((target) => {
    const action = classifyTossSubscriptionChange({
      currentPlanCode: subscription.planCode,
      targetPlanCode: target.code,
    });
    const quote = action === "immediate"
      ? quoteImmediateTossChange({
          currentPlanCode: subscription.planCode,
          targetPlanCode: target.code,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
        })
      : { action, unusedCreditKrw: 0, chargeAmountKrw: 0 };
    return {
      planCode: target.code,
      action,
      chargeAmountKrw: quote.chargeAmountKrw,
    };
  });
  return {
    subscription: {
      id: subscription.id,
      plan: tossPlan(subscription.planCode),
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      nextQuotaAt: subscription.nextQuotaAt?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      scheduledPlan: subscription.scheduledPlanCode
        ? tossPlan(subscription.scheduledPlanCode)
        : null,
      scheduledChangeEffectiveAt: subscription.scheduledChangeEffectiveAt?.toISOString() ?? null,
      paymentMethod: {
        issuerCode: subscription.issuerCode,
        cardNumberMasked: subscription.cardNumberMasked,
        cardLast4: subscription.cardLast4,
      },
    },
    usage,
    catalog,
    actions,
    paymentRestrictions,
  };
}

export type TossBillingState = Awaited<ReturnType<typeof getTossBillingState>>;
