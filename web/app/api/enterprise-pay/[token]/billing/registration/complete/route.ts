import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { chargeEnterpriseBillingItem } from "@/lib/enterprise-billing-charge";
import { requireEnterprisePaymentOwner } from "@/lib/enterprise-payment-auth";
import { apiError, HttpError } from "@/lib/http";
import { TossBillingApiError } from "@/lib/toss-billing-api";
import { registerTossBillingKey } from "@/lib/toss-billing-service";
import { assertTossEnterpriseBillingEnabled } from "@/lib/toss-billing-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type RouteContext = { params: Promise<{ token: string }> };
const schema = z.object({
  intentId: z.string().uuid(),
  authKey: z.string().min(1).max(500),
  customerKey: z.string().min(1).max(300),
}).strict();

type RegistrationIntentRow = {
  id: string;
  status: string;
  expiresAt: Date;
  paymentMethodId: string;
  providerCustomerKey: string;
  activePaymentMethodId: string | null;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "기업 카드등록 완료");
    const [{ token }, input] = await Promise.all([
      params.then((value) => z.object({ token: z.string().uuid() }).parse(value)),
      request.json().then((value) => schema.parse(value)),
    ]);
    const { session, paymentRequest } = await requireEnterprisePaymentOwner(token);
    const db = getDb();
    await assertTossEnterpriseBillingEnabled(db);
    const intent = await db.begin(async (tx) => {
      const intentRows = await tx`
        select intent.id,intent.status,intent.expires_at,intent.payment_method_id,
          cohort.provider_customer_key,profile.payment_method_id as active_payment_method_id
        from shorts_mvp.enterprise_billing_registration_intents intent
        join shorts_mvp.enterprise_billing_profiles profile
          on profile.managed_account_id=intent.managed_account_id
          and profile.app_user_id=intent.app_user_id
        join shorts_mvp.billing_customer_cohorts cohort
          on cohort.user_id=intent.app_user_id and cohort.cohort='toss_v1'
        where intent.id=${input.intentId}
          and intent.payment_request_id=${paymentRequest.requestId}
          and intent.app_user_id=${session.userId}
        limit 1
        for update of intent,profile
      `;
      const locked = intentRows[0] as RegistrationIntentRow | undefined;
      if (!locked) throw new HttpError(404, "카드등록 요청을 찾을 수 없습니다.");
      if (locked.providerCustomerKey !== input.customerKey) {
        throw new HttpError(409, "카드등록 고객 정보가 일치하지 않습니다.");
      }
      if (locked.status === "issuing" || locked.status === "manual_review") {
        return { ...locked, resultPending: true };
      }
      if (locked.status === "issued" && locked.activePaymentMethodId) {
        return { ...locked, resultPending: false };
      }
      if (locked.status !== "prepared") {
        throw new HttpError(409, "카드등록 요청 상태를 확인해 주세요.");
      }
      if (new Date(locked.expiresAt).getTime() <= Date.now()) {
        throw new HttpError(410, "카드등록 유효시간이 지났습니다. 다시 시작해 주세요.");
      }
      await tx`
        update shorts_mvp.enterprise_billing_registration_intents
        set status='issuing' where id=${input.intentId} and status='prepared'
      `;
      return { ...locked, status: "issuing", resultPending: false };
    });
    if (!intent) throw new HttpError(404, "카드등록 요청을 찾을 수 없습니다.");
    if (intent.resultPending) {
      return NextResponse.json({ state: "manual_review" }, {
        status: 202,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    let paymentMethodId = intent.activePaymentMethodId as string | null;
    if (intent.status !== "issued" || !paymentMethodId) {
      try {
        const registered = await registerTossBillingKey({
          db,
          userId: session.userId,
          authKey: input.authKey,
          paymentMethodId: intent.paymentMethodId,
        });
        paymentMethodId = registered.id;
      } catch (cause) {
        const manualReview = cause instanceof TossBillingApiError && cause.outcomeUnknown;
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.enterprise_billing_registration_intents
            set status=${manualReview ? "manual_review" : "failed"},
              failure_code=${cause instanceof TossBillingApiError ? cause.code : "REGISTRATION_FAILED"},
              failure_message=${cause instanceof Error ? cause.message : "카드등록에 실패했습니다."}
            where id=${input.intentId} and status='issuing'
          `;
          await tx`
            update shorts_mvp.enterprise_billing_profiles
            set status=${manualReview ? "manual_review" : "unregistered"}
            where managed_account_id=${paymentRequest.managedAccountId}
              and payment_method_id is null
          `;
        });
        if (manualReview) {
          return NextResponse.json({ state: "manual_review" }, {
            status: 202,
            headers: { "Cache-Control": "private, no-store" },
          });
        }
        throw cause;
      }
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.enterprise_billing_registration_intents
          set status='issued',completed_at=clock_timestamp(),failure_code=null,
            failure_message=null
          where id=${input.intentId} and status in ('issuing','issued')
        `;
        await tx`
          update shorts_mvp.enterprise_billing_profiles
          set status='active',payment_method_id=${paymentMethodId},
            registered_at=coalesce(registered_at,clock_timestamp())
          where managed_account_id=${paymentRequest.managedAccountId}
        `;
      });
    }
    const firstRows = await db`
      select id from shorts_mvp.enterprise_payment_items
      where payment_request_id=${paymentRequest.requestId}
        and status<>'paid'
      order by sort_order limit 1
    `;
    if (!firstRows[0]) {
      return NextResponse.json({ state: "succeeded" }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const result = await chargeEnterpriseBillingItem({
      token,
      itemId: firstRows[0].id,
      appUserId: session.userId,
    });
    return NextResponse.json(result, {
      status: result.state === "manual_review" ? 202 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "카드등록과 첫 결제를 완료하지 못했습니다.");
  }
}
