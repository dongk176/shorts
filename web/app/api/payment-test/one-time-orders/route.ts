import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  createNicepayOrderId,
  NICEPAY_SDK_URL,
  nicepayClientKey,
  NicepayConfigurationError,
} from "@/lib/nicepay";
import {
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  localPaymentTestOrigin,
  PAYMENT_TEST_ONE_TIME_AMOUNT,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ requestId: z.string().uuid() }).strict();

type OneTimeOrderRow = {
  id: string;
  orderId: string;
  orderName: string;
  amount: number;
  status: "pending" | "processing" | "succeeded" | "failed" | "unknown" | "expired";
  transactionId: string | null;
  resultCode: string | null;
  resultMessage: string | null;
  cardLast4: string | null;
  cardIssuer: string | null;
  cardType: string | null;
  receiptUrl: string | null;
  approvedAt: Date | null;
  createdAt: Date;
};

function safeOrder(row: OneTimeOrderRow) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderName: row.orderName,
    amount: Number(row.amount),
    status: row.status,
    transactionId: row.transactionId,
    resultCode: row.resultCode,
    resultMessage: row.resultMessage,
    cardLast4: row.cardLast4,
    cardIssuer: row.cardIssuer,
    cardType: row.cardType,
    receiptUrl: row.receiptUrl,
    approvedAt: row.approvedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) {
    return json({ detail: error.message, errorCode: error.errorCode }, { status: error.status });
  }
  if (error instanceof NicepayConfigurationError) return json({ detail: error.message }, { status: 503 });
  if (error instanceof z.ZodError) return json({ detail: "단건결제 요청 ID가 올바르지 않습니다." }, { status: 400 });
  return json({ detail: "나이스페이 단건결제 테스트를 준비하지 못했습니다." }, { status: 500 });
}

const orderColumns = `
  id,order_id,order_name,amount,status,transaction_id,result_code,result_message,
  card_last4,card_issuer,card_type,receipt_url,approved_at,created_at
`;

export async function GET(request: Request) {
  try {
    assertLocalPaymentTestHost(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const db = getDb();
    await db`
      update shorts_mvp.payment_test_one_time_orders
      set status='expired',result_code='CHECKOUT_EXPIRED'
      where user_id=${tester.userId} and status='pending' and checkout_expires_at <= clock_timestamp()
    `;
    const rows = await db.unsafe<OneTimeOrderRow[]>(`
      select ${orderColumns}
      from shorts_mvp.payment_test_one_time_orders
      where user_id=$1 order by created_at desc limit 20
    `, [tester.userId]);
    return json({ orders: rows.map(safeOrder), amount: PAYMENT_TEST_ONE_TIME_AMOUNT });
  } catch (error) {
    return paymentError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalPaymentMutation(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const input = createSchema.parse(await request.json());
    const db = getDb();
    const orderId = createNicepayOrderId("TONE");
    const orderName = "Easy Cut 나이스페이 단건결제 테스트";
    const inserted = await db`
      insert into shorts_mvp.payment_test_one_time_orders (
        user_id,request_id,order_id,order_name,amount,checkout_expires_at
      ) values (
        ${tester.userId},${input.requestId},${orderId},${orderName},
        ${PAYMENT_TEST_ONE_TIME_AMOUNT},now()+interval '10 minutes'
      )
      on conflict (request_id) do nothing
      returning id,order_id,order_name,amount,status
    `;
    const order = inserted[0] || (await db`
      select id,order_id,order_name,amount,status
      from shorts_mvp.payment_test_one_time_orders
      where user_id=${tester.userId} and request_id=${input.requestId} limit 1
    `)[0];
    if (!order) throw new PaymentTestAccessError("단건결제 요청 ID가 이미 사용되었습니다.", 409);
    if (order.status !== "pending") throw new PaymentTestAccessError("이미 처리된 단건결제 요청입니다.", 409);
    return json({
      checkoutId: order.id,
      clientId: nicepayClientKey(),
      sdkUrl: NICEPAY_SDK_URL,
      method: "card",
      orderId: order.orderId,
      amount: Number(order.amount),
      goodsName: order.orderName,
      buyerName: session.user?.displayName?.slice(0, 30) || "테스터",
      buyerEmail: tester.email,
      returnUrl: new URL("/api/payment-test/one-time-return", localPaymentTestOrigin(request)).toString(),
    });
  } catch (error) {
    return paymentError(error);
  }
}
