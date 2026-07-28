import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { syncCachedPlan } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  assertThePayOneBillingEnabled,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

const schema = z.object({
  confirmation: z.literal("서비스 처리 실행"),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  let refundCaseId: string | null = null;
  let adminId: string | null = null;
  let providerActionAttempted = false;
  try {
    assertBillingMutationRequest(request);
    const [{ caseId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => schema.parse(value)),
    ]);
    void body;
    if (!z.string().uuid().safeParse(caseId).success) {
      throw new HttpError(400, "환불 건 번호가 올바르지 않습니다.");
    }
    refundCaseId = caseId;
    adminId = admin.id;
    const db = getDb();
    const prepared = await db.begin(async (tx) => {
      const caseRows = await tx`
        select c.*,o.subscription_id,o.billing_cycle,o.user_id,o.order_id
        from shorts_mvp.admin_refund_cases c
        join shorts_mvp.billing_orders o on o.id=c.billing_order_id
        where c.id=${caseId}
        for update of c,o
      `;
      const refundCase = caseRows[0];
      if (!refundCase) throw new HttpError(404, "환불 건을 찾을 수 없습니다.");
      if (refundCase.serviceActionStatus === "succeeded") {
        return { refundCase, subscription: null, paymentMethod: null, alreadyDone: true };
      }
      if (refundCase.serviceActionStatus === "processing") {
        throw new HttpError(409, "다른 요청에서 구독·이용권 처리를 실행하고 있습니다.");
      }
      if (
        refundCase.billingAction === "none"
        && refundCase.entitlementAction === "none"
      ) {
        throw new HttpError(409, "실행하도록 선택한 구독·이용권 작업이 없습니다.");
      }
      if (!refundCase.subscriptionId) {
        throw new HttpError(409, "연결된 구독이나 패키지 이용권을 찾을 수 없습니다.");
      }
      const subscriptionRows = await tx`
        select *
        from shorts_mvp.user_subscriptions
        where id=${refundCase.subscriptionId}
        for update
      `;
      const subscription = subscriptionRows[0];
      if (!subscription) {
        throw new HttpError(409, "연결된 구독이나 패키지 이용권을 찾을 수 없습니다.");
      }
      if (
        subscription.billingCycle === "monthly"
        && refundCase.entitlementAction !== "none"
        && refundCase.billingAction === "none"
      ) {
        throw new HttpError(409, "월간 구독 종료 시에는 다음 결제 중지도 함께 선택해야 합니다.");
      }
      const paymentMethodRows = !subscription.paymentMethodId ? [] : await tx`
        select *
        from shorts_mvp.billing_payment_methods
        where id=${subscription.paymentMethodId}
      `;
      await tx`
        update shorts_mvp.admin_refund_cases
        set service_action_status='processing',assigned_to_user_id=${admin.id}
        where id=${caseId}
      `;
      return {
        refundCase,
        subscription,
        paymentMethod: paymentMethodRows[0] || null,
        alreadyDone: false,
      };
    });

    if (prepared.alreadyDone) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    const refundCase = prepared.refundCase;
    const subscription = prepared.subscription!;
    const paymentMethod = prepared.paymentMethod;
    let scheduleStatus = subscription.providerScheduleStatus || "none";

    if (refundCase.billingAction === "pause_now_keep_until_period_end") {
      assertThePayOneBillingEnabled();
      if (
        subscription.billingCycle !== "monthly"
        || subscription.paymentProvider !== "thepayone"
        || !paymentMethod
        || !paymentMethod.billingKeyCiphertext
        || !paymentMethod.billingKeyIv
        || !paymentMethod.billingKeyTag
      ) {
        throw new HttpError(409, "더페이원 월간 자동결제 정보를 확인할 수 없습니다.");
      }
      if (!["paused", "disposed"].includes(paymentMethod.providerScheduleStatus || "")) {
        providerActionAttempted = true;
        const cardId = decryptCardToken({
          ciphertext: paymentMethod.billingKeyCiphertext,
          iv: paymentMethod.billingKeyIv,
          tag: paymentMethod.billingKeyTag,
        }, paymentMethod.id);
        await changeThePayOneCardStatus(
          cardId,
          "중지",
          createPaymentTrackId("AUDT"),
        );
      }
      scheduleStatus = "paused";
    }

    const processedAt = new Date();
    await db.begin(async (tx) => {
      const lockedRows = await tx`
        select *
        from shorts_mvp.admin_refund_cases
        where id=${refundCase.id}
        for update
      `;
      if (!lockedRows[0] || lockedRows[0].serviceActionStatus !== "processing") {
        throw new HttpError(409, "구독·이용권 처리 상태가 변경되었습니다.");
      }

      if (refundCase.entitlementAction === "revoke_now") {
        await tx`
          update shorts_mvp.user_subscriptions
          set status='expired',current_period_end=least(current_period_end,${processedAt}),
            next_charge_at=null,next_quota_at=null,next_retry_at=null,grace_ends_at=null,
            cancel_at_period_end=false,canceled_at=${processedAt},ended_at=${processedAt},
            provider_schedule_status=${scheduleStatus},
            billing_review_status='clear',billing_review_reason=null
          where id=${subscription.id}
        `;
        await tx`
          update shorts_mvp.usage_grants
          set status='revoked',updated_at=clock_timestamp()
          where subscription_id=${subscription.id} and status='active'
        `;
        const activeRows = await tx`
          select s.plan_code
          from shorts_mvp.user_subscriptions s
          join shorts_mvp.plans p on p.code=s.plan_code
          where s.user_id=${subscription.userId} and s.status='active'
            and s.current_period_start <= clock_timestamp()
            and s.current_period_end > clock_timestamp()
          order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc
          limit 1
        `;
        await syncCachedPlan(
          tx,
          String(subscription.userId),
          activeRows[0]?.planCode || "free",
        );
      } else if (refundCase.entitlementAction === "end_at_current_period") {
        const effectiveAt = refundCase.entitlementEffectiveAt;
        if (!(effectiveAt instanceof Date)) {
          throw new HttpError(409, "이용권 종료 예정일을 확인할 수 없습니다.");
        }
        await tx`
          update shorts_mvp.user_subscriptions
          set current_period_end=least(current_period_end,${effectiveAt}),
            next_charge_at=null,next_quota_at=null,next_retry_at=null,grace_ends_at=null,
            cancel_at_period_end=true,canceled_at=${processedAt},
            provider_schedule_status=${scheduleStatus},
            billing_review_status='clear',billing_review_reason=null
          where id=${subscription.id} and status in ('active','past_due')
        `;
        await tx`
          update shorts_mvp.usage_grants
          set status='revoked',updated_at=clock_timestamp()
          where subscription_id=${subscription.id} and status='active'
            and valid_from >= ${effectiveAt}
        `;
        await tx`
          update shorts_mvp.usage_grants
          set expires_at=${effectiveAt},updated_at=clock_timestamp()
          where subscription_id=${subscription.id} and status='active'
            and valid_from < ${effectiveAt} and expires_at > ${effectiveAt}
        `;
      } else if (refundCase.billingAction === "pause_now_keep_until_period_end") {
        await tx`
          update shorts_mvp.user_subscriptions
          set cancel_at_period_end=true,canceled_at=${processedAt},
            next_charge_at=null,next_quota_at=null,next_retry_at=null,
            provider_schedule_status=${scheduleStatus},
            billing_review_status='clear',billing_review_reason=null
          where id=${subscription.id} and status in ('active','past_due')
        `;
      }

      if (
        paymentMethod
        && refundCase.billingAction === "pause_now_keep_until_period_end"
      ) {
        await tx`
          update shorts_mvp.billing_payment_methods
          set provider_schedule_status=${scheduleStatus},status=${scheduleStatus}
          where id=${paymentMethod.id}
        `;
      }
      await tx`
        update shorts_mvp.admin_refund_cases
        set service_action_status='succeeded'
        where id=${refundCase.id}
      `;
      await tx`
        insert into shorts_mvp.admin_refund_case_events (
          refund_case_id,actor_user_id,event_type,note,metadata
        ) values (
          ${refundCase.id},${admin.id},'refund_case.service_action_succeeded',
          '구독·이용권 처리를 별도 실행함',
          ${tx.json({
            billingAction: refundCase.billingAction,
            entitlementAction: refundCase.entitlementAction,
            entitlementEffectiveAt: refundCase.entitlementEffectiveAt,
            providerActionAttempted,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'refund_case.service_action_succeeded',
          'admin_refund_case',${refundCase.id},
          ${tx.json({
            subscriptionId: subscription.id,
            billingAction: refundCase.billingAction,
            entitlementAction: refundCase.entitlementAction,
          })}
        )
      `;
    });
    return NextResponse.json({
      ok: true,
      serviceActionStatus: "succeeded",
      paymentRefundExecuted: false,
    });
  } catch (error) {
    if (refundCaseId && adminId) {
      await getDb().begin(async (tx) => {
        await tx`
          update shorts_mvp.admin_refund_cases
          set service_action_status='manual_review'
          where id=${refundCaseId} and service_action_status='processing'
        `;
        await tx`
          insert into shorts_mvp.admin_refund_case_events (
            refund_case_id,actor_user_id,event_type,note,metadata
          ) values (
            ${refundCaseId},${adminId},'refund_case.service_action_requires_review',
            ${error instanceof Error ? error.message.slice(0, 500) : "처리 실패"},
            ${tx.json({ providerActionAttempted })}
          )
        `;
      }).catch(() => undefined);
    }
    return apiError(error, "구독·이용권 처리를 완료하지 못했습니다.");
  }
}
