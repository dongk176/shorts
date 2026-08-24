import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ cancelAtPeriodEnd: z.boolean() }).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    if (!body.cancelAtPeriodEnd) {
      throw new HttpError(
        410,
        "구독을 다시 시작하려면 저장 카드 확인 후 즉시 결제를 진행해 주세요.",
        "RESUBSCRIPTION_PAYMENT_REQUIRED",
      );
    }
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select s.*,m.provider,m.billing_key_ciphertext,m.billing_key_iv,m.billing_key_tag,
        m.provider_schedule_status as method_schedule_status
      from shorts_mvp.user_subscriptions s
      left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
      where s.user_id=${session.userId} and s.status='active'
        and s.plan_code='easycut_pro_v2' and s.billing_cycle='monthly'
        and s.current_period_end > clock_timestamp()
      order by s.created_at desc limit 1
    `;
    const subscription = rows[0];
    if (!subscription) throw new HttpError(404, "구독을 찾을 수 없습니다.");
    let scheduleStatus = subscription.providerScheduleStatus || "none";
    let monthlyCardId: string | null = null;
    let providerTransitionAttempted = false;
    try {
      if (subscription.billingCycle === "monthly") {
        if (
          subscription.provider !== "thepayone"
          || !subscription.billingKeyCiphertext
          || !subscription.billingKeyIv
          || !subscription.billingKeyTag
        ) throw new HttpError(409, "더페이원 자동결제 카드를 확인할 수 없습니다.");
        monthlyCardId = decryptCardToken({
          ciphertext: subscription.billingKeyCiphertext,
          iv: subscription.billingKeyIv,
          tag: subscription.billingKeyTag,
        }, subscription.paymentMethodId);
        providerTransitionAttempted = true;
        await changeThePayOneCardStatus(
          monthlyCardId,
          "중지",
          createPaymentTrackId("AUDT"),
        );
        scheduleStatus = "paused";
      }

      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.user_subscriptions
          set cancel_at_period_end=${body.cancelAtPeriodEnd},
            canceled_at=${body.cancelAtPeriodEnd ? new Date() : null},
            provider_schedule_status=${scheduleStatus},
            billing_review_status='clear',billing_review_reason=null
          where id=${subscription.id} and user_id=${session.userId} and status in ('active','past_due')
        `;
        if (subscription.paymentMethodId && subscription.billingCycle === "monthly") await tx`
          update shorts_mvp.billing_payment_methods
          set provider_schedule_status=${scheduleStatus},status=${scheduleStatus}
          where id=${subscription.paymentMethodId} and provider='thepayone'
        `;
      });
    } catch (error) {
      if (providerTransitionAttempted && monthlyCardId) {
        await changeThePayOneCardStatus(
          monthlyCardId,
          "중지",
          createPaymentTrackId("AUDT"),
        ).catch(() => undefined);
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.user_subscriptions
            set provider_schedule_status='manual_review',
              billing_review_status='manual_review',
              billing_review_reason='CANCELLATION_SCHEDULE_CHANGE_FAILED'
            where id=${subscription.id} and user_id=${session.userId}
              and status in ('active','past_due')
          `;
          if (subscription.paymentMethodId) await tx`
            update shorts_mvp.billing_payment_methods
            set provider_schedule_status='manual_review',status='manual_review'
            where id=${subscription.paymentMethodId} and user_id=${session.userId}
              and provider='thepayone'
          `;
        }).catch(() => undefined);
      }
      throw error;
    }
    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: body.cancelAtPeriodEnd,
      effectiveAt: body.cancelAtPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
      providerScheduleStatus: scheduleStatus,
    });
  } catch (error) {
    return apiError(error, "구독 해지 상태를 변경하지 못했습니다.");
  }
}
