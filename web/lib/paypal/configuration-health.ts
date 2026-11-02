import "server-only";
import { getDb } from "@/lib/db";
import { paypalPlans } from "./catalog";
import { paypalEnabled, paypalEnvironment, paypalPlanId, paypalRequest, PayPalProviderError } from "./api";
import { validatePayPalPlan, validatePayPalSubscription, type PayPalSubscription } from "./service";

async function inspectInPairs<T, R>(items: T[], inspect: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let i=0;i<items.length;i+=2) result.push(...await Promise.all(items.slice(i,i+2).map(inspect)));
  return result;
}

// Read-only: never creates, approves, charges, cancels, or updates a subscription.
export async function inspectPayPalConfiguration(db = getDb()) {
  const environment = paypalEnvironment();
  const plans = await inspectInPairs([...paypalPlans], async plan => {
    try {
      const id = paypalPlanId(plan.code);
      const remote = await paypalRequest<Parameters<typeof validatePayPalPlan>[0]>(`/v1/billing/plans/${id}`);
      validatePayPalPlan(remote, plan, id);
      return { code: plan.code, valid: true, currency: "USD", amountMinor: plan.amount };
    } catch (error) {
      return { code: plan.code, valid: false, providerStatus: error instanceof PayPalProviderError ? error.providerStatus : null, debugId: error instanceof PayPalProviderError ? error.debugId : undefined };
    }
  });
  const checkouts = await db`select id,user_id,plan_code,provider_plan_id,environment,provider_subscription_id,status from shorts_mvp.paypal_checkouts where environment=${environment} and provider_subscription_id is not null order by created_at desc limit 10`;
  const references = await inspectInPairs([...checkouts], async c => {
    try {
      const remote = await paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${c.providerSubscriptionId}`);
      validatePayPalSubscription(remote, c as Parameters<typeof validatePayPalSubscription>[1]);
      return { id: c.providerSubscriptionId as string, verified: true, status: remote.status };
    } catch (error) {
      return { id: c.providerSubscriptionId as string, verified: false, providerStatus: error instanceof PayPalProviderError ? error.providerStatus : null, debugId: error instanceof PayPalProviderError ? error.debugId : undefined };
    }
  });
  return { checkedAt: new Date().toISOString(), environment, enabled: paypalEnabled(), catalogValid: plans.every(p => p.valid), plans, references, guestCardEligibility: "not_verified" };
}
