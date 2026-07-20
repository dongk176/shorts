import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createProviderOrderId,
  ensureTossCustomerKey,
  getAddonProduct,
  requireActiveSubscription,
} from "@/lib/billing";
import { assertBillingMutationRequest, checkoutUrls } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { tossClientKey } from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  addonCode: z.enum(["minutes_50", "minutes_100", "minutes_300"]),
  requestId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const [subscription, product, customerKey] = await Promise.all([
      requireActiveSubscription(db, session.userId),
      getAddonProduct(db, body.addonCode),
      ensureTossCustomerKey(db, session.userId),
    ]);
    const orderId = createProviderOrderId("ADD");
    const rows = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,request_id,kind,product_code,amount_krw,
        order_id,order_name,customer_key,checkout_expires_at
      ) values (
        ${session.userId},${subscription.id},${body.requestId},'addon',${product.code},${product.priceKrw},
        ${orderId},${`Easy Cut ${product.displayName}`},${customerKey},now()+interval '10 minutes'
      )
      on conflict (request_id) do nothing
      returning id,order_id,order_name,amount_krw,customer_key,status
    `;
    const order = rows[0] || (await db`
      select id,order_id,order_name,amount_krw,customer_key,status
      from shorts_mvp.billing_orders
      where request_id=${body.requestId} and user_id=${session.userId} and kind='addon'
      limit 1
    `)[0];
    if (!order) throw new HttpError(409, "추가 시간 주문 식별자가 이미 사용되었습니다.");
    if (order.status !== "pending") throw new HttpError(409, "이미 처리된 추가 시간 주문입니다.");
    return NextResponse.json({
      checkoutId: order.id,
      clientKey: tossClientKey(),
      customerKey: order.customerKey,
      orderId: order.orderId,
      orderName: order.orderName,
      amount: Number(order.amountKrw),
      customerEmail: session.user?.email || null,
      customerName: session.user?.displayName || null,
      ...checkoutUrls(request, "addon", order.id),
    });
  } catch (error) {
    return apiError(error, "추가 시간 결제를 시작하지 못했습니다.");
  }
}
