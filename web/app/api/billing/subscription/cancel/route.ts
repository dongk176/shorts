import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveSubscription } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

const schema = z.object({ cancelAtPeriodEnd: z.boolean() });

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const subscription = await requireActiveSubscription(db, session.userId);
    await db`
      update shorts_mvp.user_subscriptions
      set cancel_at_period_end=${body.cancelAtPeriodEnd},
          canceled_at=${body.cancelAtPeriodEnd ? new Date() : null}
      where id=${subscription.id} and user_id=${session.userId} and status='active'
    `;
    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: body.cancelAtPeriodEnd,
      effectiveAt: body.cancelAtPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    });
  } catch (error) {
    return apiError(error, "구독 해지 상태를 변경하지 못했습니다.");
  }
}
