import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  chargeTossBilling,
  getTossPaymentByOrderId,
  TossBillingApiError,
  type TossBillingPaymentResponse,
} from "@/lib/toss-billing-api";
import { loadTossChargeCredentials } from "@/lib/toss-billing-service";
import { assertTossEnterpriseBillingEnabled } from "@/lib/toss-billing-runtime";

type ChargeRow = {
  requestId: string;
  requestStatus: string;
  requestExpiresAt: Date;
  itemId: string;
  itemName: string;
  itemStatus: string;
  amountKrw: number;
  sortOrder: number;
  paymentMethodId: string;
  consentId: string;
};

function verifyPayment(payment: TossBillingPaymentResponse, input: {
  orderId: string;
  amountKrw: number;
}) {
  if (
    payment.orderId !== input.orderId
    || payment.totalAmount !== input.amountKrw
    || payment.status !== "DONE"
  ) {
    throw new TossBillingApiError({
      code: "ENTERPRISE_PAYMENT_INTEGRITY_MISMATCH",
      message: "결제사 결과와 저장된 기업 주문 정보가 일치하지 않습니다.",
      outcomeUnknown: true,
    });
  }
}

async function markPaid(input: {
  attemptId: string;
  row: ChargeRow;
  payment: TossBillingPaymentResponse;
}) {
  const approvedAt = input.payment.approvedAt
    ? new Date(input.payment.approvedAt)
    : new Date();
  if (!Number.isFinite(approvedAt.getTime())) {
    throw new Error("결제 승인 시각을 확인할 수 없습니다.");
  }
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      select pg_advisory_xact_lock(hashtextextended(${`enterprise-request:${input.row.requestId}`},0))
    `;
    await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='paid',payment_key=${input.payment.paymentKey},
        provider_status=${input.payment.status},payment_method='카드',
        receipt_url=${input.payment.receiptUrl || null},approved_at=${approvedAt},
        provider_error_code=null,provider_error_message=null
      where id=${input.attemptId} and status in ('confirming','manual_review','paid')
    `;
    await tx`
      update shorts_mvp.enterprise_payment_items
      set status='paid',paid_attempt_id=${input.attemptId},paid_at=${approvedAt}
      where id=${input.row.itemId} and status<>'paid'
    `;
    const remainingRows = await tx`
      select count(*)::integer as remaining
      from shorts_mvp.enterprise_payment_items
      where payment_request_id=${input.row.requestId} and status<>'paid'
    `;
    const complete = Number(remainingRows[0]?.remaining || 0) === 0;
    await tx`
      update shorts_mvp.enterprise_payment_requests
      set status=${complete ? "paid" : "partial"},
        paid_at=${complete ? approvedAt : null}
      where id=${input.row.requestId} and status<>'canceled'
    `;
    if (complete) {
      await tx`select shorts_mvp.fulfill_enterprise_payment_request(${input.row.requestId})`;
    }
  });
}

async function markReview(attemptId: string, itemId: string, error: TossBillingApiError) {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='manual_review',provider_error_code=${error.code},
        provider_error_message=${error.message}
      where id=${attemptId} and status in ('confirming','manual_review')
    `;
    await tx`
      update shorts_mvp.enterprise_payment_items set status='manual_review'
      where id=${itemId} and status in ('confirming','manual_review')
    `;
  });
}

async function markFailed(attemptId: string, itemId: string, error: TossBillingApiError) {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='failed',provider_error_code=${error.code},
        provider_error_message=${error.message}
      where id=${attemptId} and status='confirming'
    `;
    await tx`
      update shorts_mvp.enterprise_payment_items set status='pending'
      where id=${itemId} and status='confirming'
    `;
  });
}

export async function chargeEnterpriseBillingItem(input: {
  token: string;
  itemId: string;
  appUserId: string;
}) {
  const db = getDb();
  await assertTossEnterpriseBillingEnabled(db);
  const prepared = await db.begin(async (tx) => {
    const rows = await tx`
      select payment_request.id as request_id,
        payment_request.status as request_status,
        payment_request.expires_at as request_expires_at,
        item.id as item_id,item.name as item_name,item.status as item_status,
        item.amount_krw,item.sort_order,
        profile.payment_method_id,consent.id as consent_id
      from shorts_mvp.enterprise_payment_requests payment_request
      join shorts_mvp.managed_login_accounts managed
        on managed.id=payment_request.managed_account_id
      join shorts_mvp.enterprise_payment_items item
        on item.payment_request_id=payment_request.id
      join shorts_mvp.enterprise_billing_profiles profile
        on profile.managed_account_id=managed.id and profile.status='active'
      join shorts_mvp.enterprise_payment_consents consent
        on consent.payment_request_id=payment_request.id
        and consent.app_user_id=managed.app_user_id
      where payment_request.public_token=${input.token}
        and payment_request.payment_mode='billing'
        and managed.app_user_id=${input.appUserId}
        and item.id=${input.itemId}
      limit 1
      for update of payment_request,item
    `;
    const row = rows[0] as ChargeRow | undefined;
    if (!row) throw new HttpError(404, "결제할 상품을 찾을 수 없습니다.");
    await tx`
      select pg_advisory_xact_lock(hashtextextended(${`enterprise-request:${row.requestId}`},0))
    `;
    if (row.requestStatus === "canceled") throw new HttpError(409, "취소된 결제 요청입니다.");
    if (new Date(row.requestExpiresAt).getTime() <= Date.now()) {
      throw new HttpError(410, "결제 기한이 만료되었습니다.");
    }
    if (row.itemStatus === "paid") return { state: "succeeded" as const, row };
    if (row.itemStatus === "confirming" || row.itemStatus === "manual_review") {
      throw new HttpError(409, "결제 결과를 확인하고 있습니다. 다시 결제하지 마세요.");
    }
    const previousRows = await tx`
      select id from shorts_mvp.enterprise_payment_items
      where payment_request_id=${row.requestId}
        and sort_order<${row.sortOrder} and status<>'paid'
      limit 1
    `;
    if (previousRows[0]) {
      throw new HttpError(409, "이전 순서의 결제를 먼저 완료해 주세요.");
    }
    const orderId = `entb_${randomUUID().replaceAll("-", "")}`;
    const attemptId = randomUUID();
    const attemptNumbers = await tx`
      select coalesce(max(attempt_no),0)::integer+1 as next_attempt_no
      from shorts_mvp.enterprise_payment_attempts
      where payment_item_id=${row.itemId} and idempotency_key is not null
    `;
    const attemptNo = Number(attemptNumbers[0]?.nextAttemptNo || 1);
    if (attemptNo > 10) {
      throw new HttpError(409, "결제 시도 횟수를 확인해 주세요. 고객지원으로 문의해 주세요.");
    }
    const idempotencyKey = `enterprise-billing-${row.itemId}-${attemptNo}`;
    const attempts = await tx`
      insert into shorts_mvp.enterprise_payment_attempts (
        id,payment_item_id,order_id,amount_krw,status,consent_id,
        payment_method_id,idempotency_key,attempt_no
      ) values (
        ${attemptId},${row.itemId},${orderId},${row.amountKrw},'confirming',
        ${row.consentId},${row.paymentMethodId},${idempotencyKey},${attemptNo}
      )
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning id,order_id
    `;
    if (!attempts[0]) {
      const existing = await tx`
        select id,order_id,status
        from shorts_mvp.enterprise_payment_attempts
        where idempotency_key=${idempotencyKey}
        limit 1
      `;
      if (existing[0]?.status === "paid") return { state: "succeeded" as const, row };
      throw new HttpError(409, "이 결제는 이미 처리 중입니다. 다시 결제하지 마세요.");
    }
    await tx`
      update shorts_mvp.enterprise_payment_items set status='confirming'
      where id=${row.itemId} and status='pending'
    `;
    return { state: "charge" as const, row, attemptId, orderId };
  });
  if (prepared.state === "succeeded") return { state: "succeeded" as const };

  try {
    const credentials = await loadTossChargeCredentials({
      db,
      userId: input.appUserId,
      paymentMethodId: prepared.row.paymentMethodId,
    });
    const payment = await chargeTossBilling({
      ...credentials,
      amountKrw: Number(prepared.row.amountKrw),
      orderId: prepared.orderId,
      orderName: prepared.row.itemName,
      idempotencyKey: `enterprise-charge-${prepared.attemptId}`,
    });
    verifyPayment(payment, {
      orderId: prepared.orderId,
      amountKrw: Number(prepared.row.amountKrw),
    });
    await markPaid({ attemptId: prepared.attemptId, row: prepared.row, payment });
    return { state: "succeeded" as const };
  } catch (cause) {
    const error = cause instanceof TossBillingApiError
      ? cause
      : new TossBillingApiError({
        code: "ENTERPRISE_CHARGE_FAILED",
        message: "카드 결제 결과를 확인하지 못했습니다.",
        outcomeUnknown: true,
      });
    if (error.outcomeUnknown || error.status === 409) {
      try {
        const reconciled = await getTossPaymentByOrderId(prepared.orderId);
        verifyPayment(reconciled, {
          orderId: prepared.orderId,
          amountKrw: Number(prepared.row.amountKrw),
        });
        await markPaid({ attemptId: prepared.attemptId, row: prepared.row, payment: reconciled });
        return { state: "succeeded" as const };
      } catch {
        await markReview(prepared.attemptId, prepared.row.itemId, error);
        return { state: "manual_review" as const };
      }
    }
    await markFailed(prepared.attemptId, prepared.row.itemId, error);
    throw new HttpError(402, error.message, error.code);
  }
}
