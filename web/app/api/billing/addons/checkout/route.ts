import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createBillingOrderId,
  getAddonProduct,
  requireActiveSubscription,
} from "@/lib/billing";
import {
  decryptBillingPhone,
  encryptBillingPhone,
  normalizeBillingPhone,
} from "@/lib/billing-phone";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { getDefaultPaymentMethodId } from "@/lib/default-payment-method";
import { apiError, HttpError } from "@/lib/http";
import { oneTimePaymentMode } from "@/lib/manual-payment-routing";
import { isPricingV2EarlyBirdCode } from "@/lib/pricing-v2";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  THEPAYONE_SDK_URL,
  thePayOneMerchantId,
  thePayOnePublicKey,
  thePayOneTerminalId,
  thePayOneWebhookBaseUrl,
  thePayOneWebhookSecret,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  addonCode: z.enum([
    "minutes_50",
    "minutes_100",
    "minutes_300",
    "earlybird_300",
    "earlybird_600",
    "earlybird_1000",
  ]),
  requestId: z.string().uuid(),
  payerTel: z.string()
    .transform(normalizeBillingPhone)
    .refine((value) => /^\d{10,11}$/.test(value))
    .optional(),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const addonPaymentMode = oneTimePaymentMode("addon");
    if (addonPaymentMode !== "legacy") {
      throw new HttpError(
        503,
        addonPaymentMode === "manual"
          ? "추가시간 수기결제는 요금제의 새 카드 결제창에서 진행해 주세요."
          : "추가시간 결제가 현재 중지되어 있습니다.",
        "ADDON_LEGACY_CHECKOUT_DISABLED",
      );
    }
    const session = await requireAuthenticatedMvpSession();
    if (!session.user?.email) throw new HttpError(409, "결제에 사용할 계정 이메일을 확인할 수 없습니다.");
    const db = getDb();
    const [subscription, product] = await Promise.all([
      requireActiveSubscription(db, session.userId),
      getAddonProduct(db, body.addonCode),
    ]);
    if (isPricingV2EarlyBirdCode(body.addonCode)) {
      const previous = await db`
        select id from shorts_mvp.billing_orders
        where user_id=${session.userId} and kind='addon' and product_code=${body.addonCode}
          and status in ('pending','processing','succeeded','manual_review')
        limit 1
      `;
      if (previous[0]) {
        throw new HttpError(409, "이 얼리버드 상품은 계정당 한 번만 구매할 수 있습니다.");
      }
    }
    const paymentMethodId = await getDefaultPaymentMethodId(db, session.userId)
      || subscription.paymentMethodId;
    if (!paymentMethodId) {
      throw new HttpError(409, "구독 결제수단을 확인할 수 없습니다.", "PAYMENT_METHOD_REQUIRED");
    }
    const methods = await db`
      select id,payer_tel_ciphertext,payer_tel_iv,payer_tel_tag
      from shorts_mvp.billing_payment_methods
      where id=${paymentMethodId} and user_id=${session.userId}
      limit 1
    `;
    const method = methods[0];
    if (!method) {
      throw new HttpError(409, "구독 결제수단을 확인할 수 없습니다.", "PAYMENT_METHOD_REQUIRED");
    }
    let payerTel: string;
    if (method.payerTelCiphertext && method.payerTelIv && method.payerTelTag) {
      payerTel = decryptBillingPhone({
        ciphertext: method.payerTelCiphertext,
        iv: method.payerTelIv,
        tag: method.payerTelTag,
      }, method.id);
    } else {
      if (!body.payerTel) {
        throw new HttpError(
          409,
          "기존 결제정보에 휴대전화 번호가 없어 한 번만 입력이 필요합니다.",
          "PAYER_TEL_REQUIRED",
        );
      }
      payerTel = body.payerTel;
      const encryptedPhone = encryptBillingPhone(payerTel, method.id);
      await db`
        update shorts_mvp.billing_payment_methods
        set payer_tel_ciphertext=${encryptedPhone.ciphertext},
          payer_tel_iv=${encryptedPhone.iv},payer_tel_tag=${encryptedPhone.tag}
        where id=${method.id} and user_id=${session.userId}
          and payer_tel_ciphertext is null and payer_tel_iv is null and payer_tel_tag is null
      `;
    }
    const merchantId = thePayOneMerchantId();
    const terminalId = thePayOneTerminalId();
    const orderId = createBillingOrderId("ADD");
    const orderName = `Easy Cut ${product.displayName}`;
    const rows = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,payment_method_id,request_id,kind,product_code,amount_krw,
        order_id,order_name,checkout_expires_at,provider,provider_track_id,
        provider_merchant_id,provider_terminal_id
      ) values (
        ${session.userId},${subscription.id},${method.id},${body.requestId},'addon',${product.code},${product.priceKrw},
        ${orderId},${orderName},now()+interval '10 minutes','thepayone',${orderId},
        ${merchantId},${terminalId}
      ) on conflict (request_id) do nothing
      returning id,order_id,order_name,amount_krw,status
    `;
    const order = rows[0] || (await db`
      select id,order_id,order_name,amount_krw,status
      from shorts_mvp.billing_orders
      where request_id=${body.requestId} and user_id=${session.userId} and kind='addon' limit 1
    `)[0];
    if (!order) throw new HttpError(409, "추가 시간 주문 ID가 이미 사용되었습니다.");
    if (order.status !== "pending") throw new HttpError(409, "이미 처리된 추가 시간 주문입니다.");
    const webhookUrl = new URL(
      `/api/webhooks/thepayone/${encodeURIComponent(thePayOneWebhookSecret())}`,
      thePayOneWebhookBaseUrl(),
    );
    return NextResponse.json({
      checkoutId: order.id,
      sdkUrl: THEPAYONE_SDK_URL,
      publicKey: thePayOnePublicKey(),
      amount: Number(order.amountKrw),
      trackId: order.orderId,
      webhookUrl: webhookUrl.toString(),
      udf1: order.id,
      udf2: "addon",
      payerName: (session.user.displayName || session.user.email.split("@", 1)[0] || "Easy Cut 고객").slice(0, 20),
      payerEmail: session.user.email,
      payerTel,
      products: [{
        name: order.orderName,
        price: String(order.amountKrw),
        qty: "1",
        desc: "추가 처리시간 90일 이용권",
      }],
      pendingUrl: `/billing/success?flow=addon&checkoutId=${encodeURIComponent(order.id)}&status=pending`,
    });
  } catch (error) {
    return apiError(error, "추가 시간 결제를 시작하지 못했습니다.");
  }
}
