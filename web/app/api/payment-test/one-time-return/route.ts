import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  confirmNicepayPayment,
  nicepayClientKey,
  NicepayApiError,
  verifyNicepayAuthSignature,
  verifyNicepayPaymentSignature,
} from "@/lib/nicepay";
import {
  assertLocalPaymentTestHost,
  localPaymentTestOrigin,
  PaymentTestAccessError,
} from "@/lib/payment-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callbackUrl(request: Request, orderId: string | null, result: string, code?: string | null) {
  const url = new URL("/payment-test", localPaymentTestOrigin(request));
  if (orderId) url.searchParams.set("oneTimeOrderId", orderId);
  url.searchParams.set("oneTimeResult", result);
  if (code) url.searchParams.set("code", code.slice(0, 80));
  return url;
}

function redirect(request: Request, orderId: string | null, result: string, code?: string | null) {
  const response = NextResponse.redirect(callbackUrl(request, orderId, result, code), 303);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function formValue(form: FormData, key: string, maxLength: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  let databaseOrderId: string | null = null;
  let claimed = false;
  let providerPaymentCompleted = false;
  try {
    assertLocalPaymentTestHost(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 32 * 1024) throw new PaymentTestAccessError("결제 인증 응답이 너무 큽니다.", 413);
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
      throw new PaymentTestAccessError("결제 인증 응답 형식이 올바르지 않습니다.", 415);
    }
    const form = await request.formData();
    const orderId = formValue(form, "orderId", 64);
    const authResultCode = formValue(form, "authResultCode", 80);
    const clientId = formValue(form, "clientId", 80);
    const transactionId = formValue(form, "tid", 80);
    const authToken = formValue(form, "authToken", 200);
    const signature = formValue(form, "signature", 256);
    const amount = Number(formValue(form, "amount", 20));
    if (!orderId) return redirect(request, null, "failed", authResultCode || "MISSING_ORDER_ID");
    databaseOrderId = orderId;
    const db = getDb();
    const rows = await db`
      select id,order_id,amount,status,checkout_expires_at
      from shorts_mvp.payment_test_one_time_orders
      where order_id=${orderId} limit 1
    `;
    const order = rows[0];
    if (!order) return redirect(request, orderId, "failed", "ORDER_NOT_FOUND");
    if (order.status === "succeeded") return redirect(request, orderId, "success");
    if (order.status !== "pending") return redirect(request, orderId, order.status, "ALREADY_PROCESSED");
    if (order.checkoutExpiresAt <= new Date()) {
      await db`
        update shorts_mvp.payment_test_one_time_orders
        set status='expired',auth_result_code=${authResultCode},result_code='CHECKOUT_EXPIRED'
        where id=${order.id} and status='pending'
      `;
      return redirect(request, orderId, "expired", "CHECKOUT_EXPIRED");
    }
    if (authResultCode !== "0000") {
      await db`
        update shorts_mvp.payment_test_one_time_orders
        set status='failed',auth_result_code=${authResultCode},result_code=${authResultCode},
          result_message=${formValue(form, "authResultMsg", 300)}
        where id=${order.id} and status='pending'
      `;
      return redirect(request, orderId, "failed", authResultCode || "AUTH_FAILED");
    }
    if (
      clientId !== nicepayClientKey()
      || !transactionId
      || !authToken
      || !Number.isSafeInteger(amount)
      || amount !== Number(order.amount)
      || !verifyNicepayAuthSignature({ authToken, clientId, amount, signature })
    ) {
      await db`
        update shorts_mvp.payment_test_one_time_orders
        set status='failed',auth_result_code=${authResultCode},result_code='AUTH_RESPONSE_MISMATCH'
        where id=${order.id} and status='pending'
      `;
      return redirect(request, orderId, "failed", "AUTH_RESPONSE_MISMATCH");
    }
    const claimedRows = await db`
      update shorts_mvp.payment_test_one_time_orders
      set status='processing',transaction_id=${transactionId},auth_result_code=${authResultCode}
      where id=${order.id} and status='pending'
      returning id
    `;
    if (!claimedRows[0]) return redirect(request, orderId, "processing", "ALREADY_CLAIMED");
    claimed = true;
    const payment = await confirmNicepayPayment(transactionId, amount);
    providerPaymentCompleted = payment.status === "paid";
    if (
      payment.transactionId !== transactionId
      || payment.orderId !== orderId
      || payment.amount !== amount
      || payment.status !== "paid"
      || !verifyNicepayPaymentSignature(payment)
    ) {
      throw new NicepayApiError(
        "나이스페이 승인 결과가 인증 요청과 일치하지 않습니다.",
        "PAYMENT_MISMATCH",
        502,
        true,
      );
    }
    const approvedAt = payment.paidAt && payment.paidAt !== "0" ? new Date(payment.paidAt) : new Date();
    await db`
      update shorts_mvp.payment_test_one_time_orders
      set status='succeeded',result_code=${payment.resultCode},result_message=${payment.resultMessage},
        card_last4=${payment.cardLast4},card_issuer=${payment.issuerName},card_type=${payment.cardType},
        receipt_url=${payment.receiptUrl},approved_at=${approvedAt}
      where id=${order.id} and status='processing'
    `;
    return redirect(request, orderId, "success");
  } catch (error) {
    if (databaseOrderId && claimed) {
      try {
        const unknown = providerPaymentCompleted || (error instanceof NicepayApiError && error.outcomeUnknown);
        await getDb()`
          update shorts_mvp.payment_test_one_time_orders
          set status=${unknown ? "unknown" : "failed"},
            result_code=${error instanceof NicepayApiError ? error.code : "CALLBACK_ERROR"},
            result_message=${error instanceof Error ? error.message.slice(0, 300) : null}
          where order_id=${databaseOrderId} and status='processing'
        `;
      } catch {
        // Preserve the original state; an interrupted processing row is treated as unknown.
      }
    }
    const code = error instanceof NicepayApiError ? error.code : "CALLBACK_ERROR";
    return redirect(request, databaseOrderId, error instanceof NicepayApiError && error.outcomeUnknown ? "unknown" : "failed", code);
  }
}

export async function GET(request: Request) {
  assertLocalPaymentTestHost(request);
  return redirect(request, null, "failed", "POST_REQUIRED");
}
