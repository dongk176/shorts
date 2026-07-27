import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  blocksAccountWithdrawal,
  isAccountWithdrawalConfirmation,
  type WithdrawalSubscription,
} from "@/lib/account-withdrawal";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { revokeOwnedBillingCardVerification } from "@/lib/billing-card-verifications";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { MVP_SESSION_COOKIE, requireAuthenticatedMvpSession } from "@/lib/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createPaymentTrackId,
  decryptCardToken,
  revokeThePayOneCard,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  confirmation: z.string().min(1).max(64),
}).strict();

type StoredAccount = {
  provider: string | null;
  isAdmin: boolean;
};

type StoredPaymentMethod = {
  id: string;
  provider: string;
  status: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
};

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "회원탈퇴 요청");
    const { confirmation } = schema.parse(await request.json());
    if (!isAccountWithdrawalConfirmation(confirmation)) {
      throw new HttpError(
        400,
        "회원탈퇴 확인 문구를 정확히 입력해 주세요.",
        "ACCOUNT_WITHDRAWAL_CONFIRMATION_REQUIRED",
      );
    }

    const session = await requireAuthenticatedMvpSession();
    if (!session.user) throw new HttpError(401, "로그인이 필요합니다.");
    const user = session.user;

    // Validate the admin credential before any provider or database mutation.
    const admin = createSupabaseAdminClient();
    const db = getDb();
    const accountRows = await db`
      select provider,is_admin
      from shorts_mvp.app_users
      where id=${session.userId} and auth_user_id=${user.id}
        and withdrawn_at is null
      limit 1
    ` as unknown as StoredAccount[];
    const account = accountRows[0];
    if (!account) throw new HttpError(404, "탈퇴할 계정을 찾을 수 없습니다.");

    const subscriptionRows = await db`
      select status,billing_cycle,payment_method_id,cancel_at_period_end,
        provider_schedule_status
      from shorts_mvp.user_subscriptions
      where user_id=${session.userId}
        and status in ('pending','trialing','active','past_due')
    ` as unknown as WithdrawalSubscription[];
    if (subscriptionRows.some(blocksAccountWithdrawal)) {
      throw new HttpError(
        409,
        "활성 정기구독을 먼저 해지한 뒤 다시 시도해 주세요.",
        "ACCOUNT_WITHDRAWAL_ACTIVE_SUBSCRIPTION",
      );
    }

    const inFlightVerificationRows = await db`
      select id
      from shorts_mvp.billing_card_verifications
      where user_id=${session.userId}
        and status in ('pending','consuming','revoking')
        and expires_at > clock_timestamp()
      limit 1
    `;
    if (inFlightVerificationRows[0]) {
      throw new HttpError(
        409,
        "카드 확인이 처리 중입니다. 잠시 후 다시 시도해 주세요.",
        "ACCOUNT_WITHDRAWAL_BILLING_IN_FLIGHT",
      );
    }

    const verificationRows = await db`
      select id
      from shorts_mvp.billing_card_verifications
      where user_id=${session.userId} and status in ('active','revoke_failed')
      order by created_at
    `;
    for (const verification of verificationRows) {
      try {
        await revokeOwnedBillingCardVerification(db, String(verification.id), session.userId);
      } catch (error) {
        console.error("account_withdrawal_card_verification_revoke_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        throw new HttpError(
          503,
          "저장 카드 폐기를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          "ACCOUNT_WITHDRAWAL_CARD_REVOKE_FAILED",
        );
      }
    }

    const paymentMethodRows = await db`
      select id,provider,status,billing_key_ciphertext,billing_key_iv,billing_key_tag
      from shorts_mvp.billing_payment_methods
      where user_id=${session.userId}
        and status not in ('disposed','replaced','revoked')
      order by created_at
    ` as unknown as StoredPaymentMethod[];
    for (const method of paymentMethodRows) {
      if (method.provider !== "thepayone") continue;
      try {
        const cardId = decryptCardToken({
          ciphertext: method.billingKeyCiphertext,
          iv: method.billingKeyIv,
          tag: method.billingKeyTag,
        }, method.id);
        await revokeThePayOneCard(cardId, createPaymentTrackId("AUDT"));
      } catch (error) {
        console.error("account_withdrawal_payment_method_revoke_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        await db`
          update shorts_mvp.billing_payment_methods
          set status='manual_review',provider_schedule_status='manual_review'
          where id=${method.id} and user_id=${session.userId}
        `.catch(() => undefined);
        throw new HttpError(
          503,
          "저장 카드 폐기를 완료하지 못했습니다. 고객 지원으로 문의해 주세요.",
          "ACCOUNT_WITHDRAWAL_CARD_REVOKE_FAILED",
        );
      }
    }

    await db.begin(async (tx) => {
      await tx`
        insert into shorts_mvp.account_withdrawal_retention (
          user_id,withdrawn_at,contract_payment_records_until,
          complaint_dispute_records_until,legal_records_until,
          direct_identifiers_deleted_at
        )
        values (
          ${session.userId},clock_timestamp(),
          clock_timestamp() + interval '5 years',
          clock_timestamp() + interval '3 years',
          clock_timestamp() + interval '5 years',
          clock_timestamp()
        )
        on conflict (user_id) do update
        set withdrawn_at=excluded.withdrawn_at,
          contract_payment_records_until=excluded.contract_payment_records_until,
          complaint_dispute_records_until=excluded.complaint_dispute_records_until,
          legal_records_until=excluded.legal_records_until,
          direct_identifiers_deleted_at=excluded.direct_identifiers_deleted_at
      `;
      await tx`
        insert into shorts_mvp.account_withdrawal_legal_records (
          user_id,record_type,source_id,billing_order_id,subscription_id,
          service_code,quantity,occurred_at,retention_until
        )
        select
          ${session.userId},'service_supply',e.id,null,null,
          e.event_type,e.source_duration_seconds,e.occurred_at,
          e.occurred_at + interval '5 years'
        from shorts_mvp.usage_events e
        where e.user_id=${session.userId}
          and e.event_type='source_consumed'
          and e.occurred_at > clock_timestamp() - interval '5 years'
        on conflict (record_type,source_id) do nothing
      `;
      await tx`
        insert into shorts_mvp.account_withdrawal_legal_records (
          user_id,record_type,source_id,billing_order_id,subscription_id,
          service_code,quantity,occurred_at,retention_until
        )
        select
          ${session.userId},'paid_feature_supply',e.id,e.billing_order_id,e.subscription_id,
          e.filter_type,e.result_count,e.occurred_at,
          e.occurred_at + interval '5 years'
        from shorts_mvp.popular_filter_usage_events e
        where e.user_id=${session.userId}
          and e.occurred_at > clock_timestamp() - interval '5 years'
        on conflict (record_type,source_id) do nothing
      `;
      await tx`
        update shorts_mvp.user_subscriptions
        set status=case
            when status in ('pending','trialing','active','past_due') then 'expired'
            else status
          end,
          cancel_at_period_end=true,next_charge_at=null,next_quota_at=null,
          next_retry_at=null,retry_count=0,ended_at=coalesce(ended_at,clock_timestamp()),
          payment_method_id=null,provider_schedule_status=case
            when payment_provider='thepayone' then 'disposed'
            else 'none'
          end,
          billing_review_status='clear',billing_review_reason=null
        where user_id=${session.userId}
      `;
      await tx`
        update shorts_mvp.usage_grants
        set status='revoked',reserved_seconds=0,updated_at=clock_timestamp()
        where user_id=${session.userId} and status='active'
      `;
      await tx`delete from shorts_mvp.mvp_sessions where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.custom_templates where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.template_favorite_preferences where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.project_feedback_responses where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.project_feedback_prompt_deferrals where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.user_onboarding_profiles where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.ebook_download_counters where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.popular_filter_usage_events where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.youtube_analysis_rate_limits where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.payment_test_one_time_orders where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.payment_test_recurring_runs where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.payment_method_registrations where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.billing_card_verifications where user_id=${session.userId}`;
      await tx`delete from shorts_mvp.billing_payment_methods where user_id=${session.userId}`;
      await tx`
        update shorts_mvp.app_users
        set auth_user_id=null,email=null,display_name=null,avatar_url=null,
          provider='withdrawn',selected_plan_code='free',
          default_payment_method_id=null,is_admin=false,
          withdrawn_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=${session.userId} and auth_user_id=${user.id}
      `;
    });

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      console.error("account_withdrawal_auth_delete_failed", {
        errorName: deleteAuthError.name || "AuthAdminError",
        status: deleteAuthError.status,
      });
      await db.begin(async (tx) => {
        await tx`
          delete from shorts_mvp.account_withdrawal_legal_records
          where user_id=${session.userId}
        `;
        await tx`
          delete from shorts_mvp.account_withdrawal_retention
          where user_id=${session.userId}
        `;
        await tx`
          update shorts_mvp.app_users
          set auth_user_id=${user.id},email=${user.email},
            display_name=${user.displayName},avatar_url=${user.avatarUrl},
            provider=${account.provider || "google"},is_admin=${account.isAdmin},
            withdrawn_at=null,updated_at=clock_timestamp()
          where id=${session.userId} and auth_user_id is null
        `;
      }).catch(() => undefined);
      throw new HttpError(
        503,
        "인증 계정 삭제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "ACCOUNT_WITHDRAWAL_AUTH_DELETE_FAILED",
      );
    }

    const cookieStore = await cookies();
    cookieStore.delete(MVP_SESSION_COOKIE);
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The admin deletion already invalidates the account. Cookie cleanup is best effort.
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "회원탈퇴를 처리하지 못했습니다.");
  }
}
