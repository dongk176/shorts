import { NextResponse } from "next/server";
import { z } from "zod";
import { billingCycles, paidPlanCodes } from "@/lib/contracts";
import { getPaidPlan, requireActiveSubscription } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

const schema = z.object({
  planCode: z.enum(paidPlanCodes),
  billingCycle: z.enum(billingCycles),
});

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const [subscription] = await Promise.all([
      requireActiveSubscription(db, session.userId),
      getPaidPlan(db, body.planCode),
    ]);
    const unchanged = subscription.planCode === body.planCode && subscription.billingCycle === body.billingCycle;
    await db`
      update shorts_mvp.user_subscriptions
      set scheduled_plan_code=${unchanged ? null : body.planCode},
          scheduled_billing_cycle=${unchanged ? null : body.billingCycle}
      where id=${subscription.id} and user_id=${session.userId} and status='active'
    `;
    return NextResponse.json({
      ok: true,
      scheduledPlanCode: unchanged ? null : body.planCode,
      scheduledBillingCycle: unchanged ? null : body.billingCycle,
      effectiveAt: subscription.currentPeriodEnd.toISOString(),
    });
  } catch (error) {
    return apiError(error, "구독 변경을 예약하지 못했습니다.");
  }
}
