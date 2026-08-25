import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  confirmTossGeneralPayment,
  getTossGeneralPaymentByOrderId,
  TossGeneralPaymentApiError,
  type TossGeneralPayment,
} from "@/lib/toss-general-payment-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type RouteContext = {
  params: Promise<{ token: string; attemptId: string }>;
};

const paramsSchema = z.object({
  token: z.string().uuid(),
  attemptId: z.string().uuid(),
});

const bodySchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  amount: z.number().int().min(100).max(1_000_000_000),
}).strict();

type AttemptRow = {
  id: string;
  orderId: string;
  amountKrw: number;
  status: string;
  paymentKey: string | null;
  itemId: string;
  itemStatus: string;
  requestId: string;
  requestStatus: string;
};

function verifyPayment(payment: TossGeneralPayment, attempt: AttemptRow, paymentKey: string) {
  if (
    payment.paymentKey !== paymentKey
    || payment.orderId !== attempt.orderId
    || payment.totalAmount !== Number(attempt.amountKrw)
  ) {
    throw new TossGeneralPaymentApiError({
      code: "PAYMENT_INTEGRITY_MISMATCH",
      message: "결제사 결과와 저장된 주문 정보가 일치하지 않습니다.",
      outcomeUnknown: true,
    });
  }
  if (payment.status !== "DONE") {
    throw new TossGeneralPaymentApiError({
      code: "PAYMENT_NOT_DONE",
      message: "카드 결제가 아직 완료되지 않았습니다.",
      outcomeUnknown: true,
    });
  }
  if (payment.type && payment.type !== "NORMAL") {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PAYMENT_TYPE",
      message: "일반결제 승인 결과가 아닙니다.",
      outcomeUnknown: true,
    });
  }
  if (payment.method !== "카드") {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PAYMENT_METHOD",
      message: "카드 결제 승인 결과가 아닙니다.",
      outcomeUnknown: true,
    });
  }
}

async function markManualReview(attempt: AttemptRow, code: string, message: string) {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='manual_review',provider_error_code=${code},
        provider_error_message=${message}
      where id=${attempt.id} and status in ('confirming','manual_review')
    `;
    await tx`
      update shorts_mvp.enterprise_payment_items
      set status='manual_review'
      where id=${attempt.itemId} and status in ('pending','confirming','manual_review')
    `;
  });
}

async function markFailed(attempt: AttemptRow, code: string, message: string) {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='failed',provider_error_code=${code},provider_error_message=${message}
      where id=${attempt.id} and status='confirming'
    `;
    await tx`
      update shorts_mvp.enterprise_payment_items item
      set status='pending'
      where item.id=${attempt.itemId}
        and item.status='confirming'
        and not exists (
          select 1
          from shorts_mvp.enterprise_payment_attempts live_attempt
          where live_attempt.payment_item_id=item.id
            and live_attempt.status in ('confirming','manual_review')
        )
    `;
  });
}

async function markPaid(attempt: AttemptRow, payment: TossGeneralPayment) {
  const approvedAt = payment.approvedAt ? new Date(payment.approvedAt) : new Date();
  if (!Number.isFinite(approvedAt.getTime())) {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제 승인 시각을 확인할 수 없습니다.",
      outcomeUnknown: true,
    });
  }
  const db = getDb();
  await db.begin(async (tx) => {
    const updatedAttempts = await tx`
      update shorts_mvp.enterprise_payment_attempts
      set status='paid',provider_status=${payment.status},
        payment_method=${payment.method},receipt_url=${payment.receiptUrl},
        approved_at=${approvedAt},provider_error_code=null,provider_error_message=null
      where id=${attempt.id}
        and status in ('confirming','manual_review','paid')
      returning id
    `;
    if (!updatedAttempts[0]) {
      throw new HttpError(409, "결제 승인 상태가 이미 변경되었습니다.");
    }
    await tx`
      update shorts_mvp.enterprise_payment_items
      set status='paid',paid_attempt_id=${attempt.id},paid_at=${approvedAt}
      where id=${attempt.itemId} and status<>'paid'
    `;
    await tx`
      update shorts_mvp.enterprise_payment_requests payment_request
      set status=case
          when not exists (
            select 1
            from shorts_mvp.enterprise_payment_items item
            where item.payment_request_id=payment_request.id
              and item.status<>'paid'
          ) then 'paid'
          else 'partial'
        end,
        paid_at=case
          when not exists (
            select 1
            from shorts_mvp.enterprise_payment_items item
            where item.payment_request_id=payment_request.id
              and item.status<>'paid'
          ) then ${approvedAt}
          else null
        end
      where payment_request.id=${attempt.requestId}
        and payment_request.status<>'canceled'
    `;
  });
}

async function reconcile(attempt: AttemptRow, paymentKey: string) {
  const payment = await getTossGeneralPaymentByOrderId(attempt.orderId);
  verifyPayment(payment, attempt, paymentKey);
  return payment;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "결제 승인");
    const [{ token, attemptId }, input] = await Promise.all([
      params.then((value) => paramsSchema.parse(value)),
      request.json().then((value) => bodySchema.parse(value)),
    ]);
    const db = getDb();
    const rows = await db`
      select
        attempt.id,attempt.order_id,attempt.amount_krw,attempt.status,
        attempt.payment_key,item.id as item_id,item.status as item_status,
        payment_request.id as request_id,payment_request.status as request_status
      from shorts_mvp.enterprise_payment_attempts attempt
      join shorts_mvp.enterprise_payment_items item
        on item.id=attempt.payment_item_id
      join shorts_mvp.enterprise_payment_requests payment_request
        on payment_request.id=item.payment_request_id
      where payment_request.public_token=${token}
        and attempt.id=${attemptId}
      limit 1
    `;
    const attempt = rows[0] as AttemptRow | undefined;
    if (!attempt) throw new HttpError(404, "결제 주문을 찾을 수 없습니다.");
    if (attempt.requestStatus === "canceled") {
      throw new HttpError(409, "취소된 결제 요청입니다.");
    }
    if (input.orderId !== attempt.orderId || input.amount !== Number(attempt.amountKrw)) {
      throw new HttpError(400, "결제 금액 또는 주문번호가 저장된 정보와 일치하지 않습니다.");
    }
    if (attempt.paymentKey && attempt.paymentKey !== input.paymentKey) {
      throw new HttpError(409, "이미 다른 결제 승인 결과가 연결된 주문입니다.");
    }
    if (attempt.status === "failed") {
      throw new HttpError(409, "종료된 결제 시도입니다. 결제 요청 화면에서 다시 시도해 주세요.");
    }
    if (attempt.status === "paid" || attempt.itemStatus === "paid") {
      return NextResponse.json({ state: "succeeded" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const claimed = await db.begin(async (tx) => {
      const lockedRows = await tx`
        select status,payment_key
        from shorts_mvp.enterprise_payment_attempts
        where id=${attempt.id}
        for update
      `;
      const locked = lockedRows[0];
      if (!locked) throw new HttpError(404, "결제 주문을 찾을 수 없습니다.");
      if (locked.paymentKey && locked.paymentKey !== input.paymentKey) {
        throw new HttpError(409, "이미 다른 결제 승인 결과가 연결된 주문입니다.");
      }
      if (locked.status === "paid") return "paid" as const;
      if (locked.status === "failed") {
        throw new HttpError(409, "종료된 결제 시도입니다.");
      }
      if (locked.status === "prepared") {
        await tx`
          update shorts_mvp.enterprise_payment_attempts
          set status='confirming',payment_key=${input.paymentKey},
            provider_error_code=null,provider_error_message=null
          where id=${attempt.id}
        `;
        await tx`
          update shorts_mvp.enterprise_payment_items
          set status='confirming'
          where id=${attempt.itemId} and status='pending'
        `;
        return "confirm" as const;
      }
      return "reconcile" as const;
    });
    if (claimed === "paid") {
      return NextResponse.json({ state: "succeeded" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    let payment: TossGeneralPayment;
    try {
      payment = claimed === "confirm"
        ? await confirmTossGeneralPayment({
          paymentKey: input.paymentKey,
          orderId: attempt.orderId,
          amount: Number(attempt.amountKrw),
          idempotencyKey: `enterprise-payment-${attempt.id}`,
        })
        : await reconcile(attempt, input.paymentKey);
      verifyPayment(payment, attempt, input.paymentKey);
    } catch (error) {
      const providerError = error instanceof TossGeneralPaymentApiError
        ? error
        : new TossGeneralPaymentApiError({
          code: "PAYMENT_CONFIRM_FAILED",
          message: "결제 승인 결과를 확인하지 못했습니다.",
          outcomeUnknown: true,
        });
      if (claimed === "confirm" && (
        providerError.outcomeUnknown
        || providerError.status === 409
        || /ALREADY|DUPLICAT/.test(providerError.code)
      )) {
        try {
          payment = await reconcile(attempt, input.paymentKey);
          await markPaid(attempt, payment);
          return NextResponse.json({ state: "succeeded" }, {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          await markManualReview(attempt, providerError.code, providerError.message);
          return NextResponse.json({
            state: "manual_review",
            message: "결제 결과를 안전하게 확인하고 있습니다. 다시 결제하지 마세요.",
          }, { status: 202, headers: { "Cache-Control": "no-store" } });
        }
      }
      if (claimed === "reconcile" || providerError.outcomeUnknown) {
        await markManualReview(attempt, providerError.code, providerError.message);
        return NextResponse.json({
          state: "manual_review",
          message: "결제 결과를 안전하게 확인하고 있습니다. 다시 결제하지 마세요.",
        }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }
      await markFailed(attempt, providerError.code, providerError.message);
      return NextResponse.json({
        state: "failed",
        code: providerError.code,
        message: providerError.message,
      }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }

    await markPaid(attempt, payment);
    return NextResponse.json({ state: "succeeded" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error, "결제 승인을 완료하지 못했습니다.");
  }
}
