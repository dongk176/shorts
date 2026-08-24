import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  adminSubscriptionStatuses,
  planAdminSubscriptionPeriod,
  planAdminSubscriptionProviderTransition,
  type AdminSubscriptionProviderAction,
} from "@/lib/admin-subscription";
import { addKstMonths, getPaidPlan, syncCachedPlan } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  assertThePayOneBillingEnabled,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  targetStatus: z.enum(adminSubscriptionStatuses),
  reason: z.string().trim().min(2).max(500),
}).strict();

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
}

export async function POST(request: Request) {
  let changeId: string | null = null;
  let subscriptionId: string | null = null;
  let paymentMethodId: string | null = null;
  let providerAction: AdminSubscriptionProviderAction = "none";
  let providerActionAttempted = false;
  let providerActionCompleted = false;
  let cardId: string | null = null;

  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    const body = schema.parse(await request.json());
    const db = getDb();

    const prepared = await db.begin(async (tx) => {
      const existing = await tx`
        select * from shorts_mvp.admin_subscription_changes
        where request_id=${body.requestId}
        limit 1
      `;
      if (existing[0]) return { change: existing[0], subscription: null, transition: null };

      const rows = await tx`
        select s.*,u.email,
          m.provider as method_provider,m.status as method_status,
          m.provider_schedule_status as method_schedule_status,
          m.billing_key_ciphertext,m.billing_key_iv,m.billing_key_tag
        from shorts_mvp.user_subscriptions s
        join shorts_mvp.app_users u on u.id=s.user_id
        left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
        where s.id=${body.subscriptionId} and s.user_id=${body.userId}
        for update of s
      `;
      const subscription = rows[0];
      if (!subscription) throw new HttpError(404, "변경할 회원 구독을 찾을 수 없습니다.");
      if (subscription.status === body.targetStatus) {
        throw new HttpError(409, "이미 선택한 구독 상태입니다.");
      }
      const inProgress = await tx`
        select id from shorts_mvp.admin_subscription_changes
        where subscription_id=${subscription.id} and status in ('pending','processing')
        limit 1
      `;
      if (inProgress[0]) {
        throw new HttpError(409, "이 회원의 다른 구독 상태 변경이 처리 중입니다.");
      }

      const hasUsableThePayOneMethod = subscription.methodProvider === "thepayone"
        && Boolean(
          subscription.paymentMethodId
          && subscription.billingKeyCiphertext
          && subscription.billingKeyIv
          && subscription.billingKeyTag,
        )
        && !["disposed", "replaced", "revoked"].includes(subscription.methodStatus || "");
      const transition = planAdminSubscriptionProviderTransition({
        targetStatus: body.targetStatus,
        billingCycle: subscription.billingCycle,
        paymentProvider: subscription.paymentProvider,
        providerScheduleStatus: subscription.providerScheduleStatus || "none",
        hasUsableThePayOneMethod,
      });
      const inserted = await tx`
        insert into shorts_mvp.admin_subscription_changes (
          request_id,subscription_id,user_id,requested_by_user_id,
          previous_status,target_status,reason,provider_action,provider_action_status
        ) values (
          ${body.requestId},${subscription.id},${subscription.userId},${admin.id},
          ${subscription.status},${body.targetStatus},${body.reason},${transition.action},
          ${transition.action === "none" ? "not_required" : "pending"}
        )
        returning *
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'subscription.status_change_requested','user_subscription',${subscription.id},
          ${tx.json({
            requestId: body.requestId,
            userId: body.userId,
            email: subscription.email,
            previousStatus: subscription.status,
            targetStatus: body.targetStatus,
            providerAction: transition.action,
            reason: body.reason,
          })}
        )
      `;
      return { change: inserted[0], subscription, transition };
    });

    const change = prepared.change;
    changeId = change.id;
    subscriptionId = change.subscriptionId;
    if (change.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        subscriptionId: change.subscriptionId,
        status: change.targetStatus,
      });
    }
    if (change.status !== "pending" || !prepared.subscription || !prepared.transition) {
      throw new HttpError(409, "이미 처리 중이거나 확인이 필요한 구독 상태 변경입니다.");
    }

    const claimed = await db`
      update shorts_mvp.admin_subscription_changes
      set status='processing'
      where id=${change.id} and status='pending'
      returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 구독 상태를 변경하고 있습니다.");

    const subscription = prepared.subscription;
    const transition = prepared.transition;
    providerAction = transition.action;
    paymentMethodId = subscription.paymentMethodId || null;

    if (providerAction !== "none") {
      assertThePayOneBillingEnabled();
      cardId = decryptCardToken({
        ciphertext: subscription.billingKeyCiphertext,
        iv: subscription.billingKeyIv,
        tag: subscription.billingKeyTag,
      }, subscription.paymentMethodId);
      providerActionAttempted = true;
      await changeThePayOneCardStatus(
        cardId,
        providerAction === "enable" ? "사용" : "중지",
        createPaymentTrackId("AUDT"),
      );
      providerActionCompleted = true;
    }

    const changedAt = new Date();
    const period = planAdminSubscriptionPeriod({
      targetStatus: body.targetStatus,
      billingCycle: subscription.billingCycle,
      currentPeriodStart: subscription.currentPeriodStart || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      billingAnchorDay: Number(subscription.billingAnchorDay) || null,
      now: changedAt,
    });

    await db.begin(async (tx) => {
      const lockedRows = await tx`
        select * from shorts_mvp.user_subscriptions
        where id=${subscription.id} and user_id=${body.userId}
        for update
      `;
      const locked = lockedRows[0];
      if (!locked || locked.status !== change.previousStatus) {
        throw new HttpError(409, "구독 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      }

      let nextQuotaAt: Date | null = null;
      if (body.targetStatus === "active") {
        const plan = await getPaidPlan(tx, subscription.planCode);
        const activeGrants = await tx`
          select id,expires_at from shorts_mvp.usage_grants
          where subscription_id=${subscription.id} and kind='base' and status='active'
            and valid_from <= ${changedAt} and expires_at > ${changedAt}
          order by valid_from desc
          limit 1
        `;
        let currentGrant = activeGrants[0] || null;
        if (!currentGrant) {
          const restored = await tx`
            update shorts_mvp.usage_grants
            set status='active'
            where id=(
              select id from shorts_mvp.usage_grants
              where subscription_id=${subscription.id} and kind='base' and status='revoked'
                and valid_from <= ${changedAt} and expires_at > ${changedAt}
              order by valid_from desc
              limit 1
            )
            returning id,expires_at
          `;
          currentGrant = restored[0] || null;
        }
        if (!currentGrant) {
          const grantEndCandidate = addKstMonths(
            changedAt,
            1,
            subscription.billingCycle === "monthly"
              ? Number(subscription.billingAnchorDay) || undefined
              : undefined,
          );
          const grantEnd = period.periodEnd && period.periodEnd < grantEndCandidate
            ? period.periodEnd
            : grantEndCandidate;
          const insertedGrant = await tx`
            insert into shorts_mvp.usage_grants (
              user_id,subscription_id,billing_order_id,kind,product_code,
              total_seconds,credited_seconds,carried_seconds,valid_from,expires_at,status
            ) values (
              ${body.userId},${subscription.id},null,'base',${plan.code},
              ${plan.monthlySourceSeconds},${plan.monthlySourceSeconds},0,
              ${changedAt},${grantEnd},'active'
            )
            returning id,expires_at
          `;
          currentGrant = insertedGrant[0];
        }
        nextQuotaAt = currentGrant.expiresAt;
        await tx`
          update shorts_mvp.user_subscriptions
          set status='active',current_period_start=${period.periodStart},
            current_period_end=${period.periodEnd},next_charge_at=${period.nextChargeAt},
            next_quota_at=${nextQuotaAt},cancel_at_period_end=false,canceled_at=null,ended_at=null,
            scheduled_plan_code=null,scheduled_billing_cycle=null,retry_count=0,
            next_retry_at=null,grace_ends_at=null,
            provider_schedule_status=${transition.scheduleStatus},
            billing_review_status=${transition.requiresReview ? "manual_review" : "clear"},
            billing_review_reason=${transition.reviewReason}
          where id=${subscription.id}
        `;
        await syncCachedPlan(tx, body.userId, plan.code);
      } else {
        await tx`
          update shorts_mvp.usage_grants
          set status='revoked'
          where subscription_id=${subscription.id} and status='active'
            and (
              kind='base'
              or ${body.targetStatus} in ('canceled','expired')
            )
        `;
        await tx`
          update shorts_mvp.user_subscriptions
          set status=${body.targetStatus},next_charge_at=null,next_retry_at=null,next_quota_at=null,
            cancel_at_period_end=false,scheduled_plan_code=null,scheduled_billing_cycle=null,
            grace_ends_at=${body.targetStatus === "past_due"
              ? new Date(changedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
              : null},
            canceled_at=${body.targetStatus === "canceled" ? changedAt : null},
            ended_at=${["canceled", "expired"].includes(body.targetStatus) ? changedAt : null},
            provider_schedule_status=${transition.scheduleStatus},
            billing_review_status=${transition.requiresReview ? "manual_review" : "clear"},
            billing_review_reason=${transition.reviewReason}
          where id=${subscription.id}
        `;
        await syncCachedPlan(tx, body.userId, "free");
      }

      if (paymentMethodId && subscription.billingCycle === "monthly") await tx`
        update shorts_mvp.billing_payment_methods
        set provider_schedule_status=${transition.scheduleStatus},
          status=${transition.requiresReview
            ? "manual_review"
            : body.targetStatus === "active" ? "active" : "paused"}
        where id=${paymentMethodId} and user_id=${body.userId}
      `;
      await tx`
        update shorts_mvp.admin_subscription_changes
        set status='succeeded',
          provider_action_status=${providerAction === "none" ? "not_required" : "succeeded"},
          failure_message=null,processed_at=${changedAt}
        where id=${change.id} and status='processing'
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'subscription.status_changed','user_subscription',${subscription.id},
          ${tx.json({
            requestId: body.requestId,
            userId: body.userId,
            previousStatus: change.previousStatus,
            targetStatus: body.targetStatus,
            reason: body.reason,
            providerAction,
            providerScheduleStatus: transition.scheduleStatus,
            periodReset: period.periodReset,
            currentPeriodStart: period.periodStart,
            currentPeriodEnd: period.periodEnd,
            nextQuotaAt,
          })}
        )
      `;
    });

    return NextResponse.json({
      ok: true,
      subscriptionId: subscription.id,
      status: body.targetStatus,
      providerScheduleStatus: transition.scheduleStatus,
      requiresManualReview: transition.requiresReview,
      periodReset: period.periodReset,
      currentPeriodStart: period.periodStart?.toISOString() || null,
      currentPeriodEnd: period.periodEnd?.toISOString() || null,
      nextChargeAt: period.nextChargeAt?.toISOString() || null,
    });
  } catch (error) {
    const providerOutcomeUnknown = error instanceof ThePayOneError && error.outcomeUnknown;
    const requiresManualReview = providerOutcomeUnknown || providerActionCompleted;
    if (providerAction === "enable" && cardId && (providerActionAttempted || providerActionCompleted)) {
      await changeThePayOneCardStatus(
        cardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).catch(() => undefined);
    }
    if (changeId) {
      try {
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.admin_subscription_changes
            set status=${requiresManualReview ? "manual_review" : "failed"},
              provider_action_status=${providerActionAttempted
                ? requiresManualReview ? "manual_review" : "failed"
                : "not_required"},
              failure_message=${safeFailureMessage(error)},processed_at=now()
            where id=${changeId} and status in ('pending','processing')
          `;
          if (subscriptionId && providerActionAttempted) await tx`
            update shorts_mvp.user_subscriptions
            set provider_schedule_status='manual_review',
              billing_review_status='manual_review',
              billing_review_reason='ADMIN_STATUS_CHANGE_PROVIDER_FAILED'
            where id=${subscriptionId}
          `;
          if (paymentMethodId && providerActionAttempted) await tx`
            update shorts_mvp.billing_payment_methods
            set provider_schedule_status='manual_review',status='manual_review'
            where id=${paymentMethodId}
          `;
        });
      } catch {
        // Preserve the original state transition failure for operator reconciliation.
      }
    }
    return apiError(error, "회원 구독 상태를 변경하지 못했습니다.");
  }
}
