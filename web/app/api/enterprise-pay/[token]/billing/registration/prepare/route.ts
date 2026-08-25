import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest, billingRequestOrigin } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { requireEnterprisePaymentOwner } from "@/lib/enterprise-payment-auth";
import { apiError, HttpError } from "@/lib/http";
import { tossBillingClientKey } from "@/lib/toss-billing-config";
import { assertTossEnterpriseBillingEnabled } from "@/lib/toss-billing-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "기업 카드등록 준비");
    const { token } = z.object({ token: z.string().uuid() }).parse(await params);
    const { session, paymentRequest } = await requireEnterprisePaymentOwner(token);
    const db = getDb();
    await assertTossEnterpriseBillingEnabled(db);
    const prepared = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${`enterprise-registration:${paymentRequest.requestId}`},0))
      `;
      const rows = await tx`
        select profile.status,profile.payment_method_id,cohort.provider_customer_key,
          consent.id as consent_id,
          exists (
            select 1 from shorts_mvp.enterprise_payment_items item
            where item.payment_request_id=${paymentRequest.requestId}
              and item.sort_order=1 and item.status='pending'
          ) as first_item_pending
        from shorts_mvp.enterprise_billing_profiles profile
        join shorts_mvp.billing_customer_cohorts cohort
          on cohort.user_id=profile.app_user_id and cohort.cohort='toss_v1'
        left join shorts_mvp.enterprise_payment_consents consent
          on consent.payment_request_id=${paymentRequest.requestId}
          and consent.app_user_id=profile.app_user_id
        where profile.managed_account_id=${paymentRequest.managedAccountId}
          and profile.app_user_id=${session.userId}
        for update of profile
      `;
      const profile = rows[0];
      if (!profile?.consentId) throw new HttpError(409, "필수 약관에 먼저 동의해 주세요.");
      if (profile.status === "active" && profile.paymentMethodId) {
        throw new HttpError(409, "이미 카드가 등록되어 있습니다.");
      }
      if (!profile.firstItemPending) {
        throw new HttpError(409, "첫 번째 결제 상품의 상태를 확인해 주세요.");
      }
      const live = await tx`
        select id,payment_method_id,expires_at,status
        from shorts_mvp.enterprise_billing_registration_intents
        where payment_request_id=${paymentRequest.requestId}
          and status in ('prepared','issuing','manual_review')
        order by created_at desc limit 1 for update
      `;
      if (live[0]?.status === "issuing" || live[0]?.status === "manual_review") {
        throw new HttpError(409, "카드등록 결과를 확인하고 있습니다. 다시 등록하지 마세요.");
      }
      if (live[0] && new Date(live[0].expiresAt).getTime() > Date.now()) {
        return {
          intentId: live[0].id as string,
          paymentMethodId: live[0].paymentMethodId as string,
          customerKey: profile.providerCustomerKey as string,
        };
      }
      if (live[0]) {
        await tx`
          update shorts_mvp.enterprise_billing_registration_intents
          set status='expired' where id=${live[0].id} and status='prepared'
        `;
      }
      const intentId = randomUUID();
      const paymentMethodId = randomUUID();
      await tx`
        insert into shorts_mvp.enterprise_billing_registration_intents (
          id,payment_request_id,managed_account_id,app_user_id,
          payment_method_id,expires_at
        ) values (
          ${intentId},${paymentRequest.requestId},${paymentRequest.managedAccountId},
          ${session.userId},${paymentMethodId},clock_timestamp()+interval '15 minutes'
        )
      `;
      await tx`
        update shorts_mvp.enterprise_billing_profiles set status='registration_pending'
        where managed_account_id=${paymentRequest.managedAccountId}
          and status='unregistered'
      `;
      return { intentId, paymentMethodId, customerKey: profile.providerCustomerKey as string };
    });
    const origin = billingRequestOrigin(request);
    const successUrl = new URL(`/enterprise-pay/${encodeURIComponent(token)}/billing/success`, origin);
    successUrl.searchParams.set("intentId", prepared.intentId);
    const failUrl = new URL(`/enterprise-pay/${encodeURIComponent(token)}/billing/fail`, origin);
    failUrl.searchParams.set("intentId", prepared.intentId);
    return NextResponse.json({
      clientKey: tossBillingClientKey(),
      customerKey: prepared.customerKey,
      successUrl: successUrl.toString(),
      failUrl: failUrl.toString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "카드등록을 준비하지 못했습니다.");
  }
}
