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
} from "@/lib/billing-phone";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { isPricingV2EarlyBirdCode } from "@/lib/pricing-v2";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  chargeThePayOneCard,
  decryptCardToken,
  thePayOneMerchantId,
  thePayOneTerminalId,
  ThePayOneError,
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
  expectedChargeAmountKrw: z.number().int().positive(),
  payerTel: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{10,11}$/.test(value))
    .optional(),
  identityNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
}).strict();

type StoredMethod = Record<string, unknown> & {
  id: string;
  provider: string;
  status: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
  payerTelCiphertext: string | null;
  payerTelIv: string | null;
  payerTelTag: string | null;
};

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  const diagnostic = error instanceof ThePayOneError && error.diagnostic
    ? ` · 상세: ${error.diagnostic}`
    : "";
  return `${error.message}${diagnostic}`
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
}

export async function POST(request: Request) {
  let billingOrderId: string | null = null;
  let billingAttemptId: string | null = null;
  let claimedOrder = false;
  let providerPaymentCompleted = false;
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    if (!session.user?.email) {
      throw new HttpError(409, "결제에 사용할 계정 이메일을 확인할 수 없습니다.");
    }
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
    if (body.expectedChargeAmountKrw !== product.priceKrw) {
      throw new HttpError(
        409,
        "확인한 뒤 결제 금액이 변경되었습니다. 금액을 다시 확인해 주세요.",
        "PAYMENT_QUOTE_CHANGED",
      );
    }
    if (!subscription.paymentMethodId) {
      throw new HttpError(409, "구독 결제수단을 확인할 수 없습니다.", "PAYMENT_METHOD_REQUIRED");
    }
    const methods = await db`
      select * from shorts_mvp.billing_payment_methods
      where id=${subscription.paymentMethodId} and user_id=${session.userId}
      limit 1
    `;
    const method = (methods[0] || null) as StoredMethod | null;
    if (
      !method
      || method.provider !== "thepayone"
      || ["disposed", "manual_review", "replaced", "revoked"].includes(method.status)
    ) {
      throw new HttpError(
        409,
        "저장된 결제수단을 사용할 수 없습니다. 결제수단을 변경해 주세요.",
        "PAYMENT_METHOD_REQUIRED",
      );
    }
    const cardId = decryptCardToken({
      ciphertext: method.billingKeyCiphertext,
      iv: method.billingKeyIv,
      tag: method.billingKeyTag,
    }, method.id);
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
    const inserted = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,payment_method_id,request_id,kind,product_code,amount_krw,
        order_id,order_name,provider,provider_track_id,provider_merchant_id,
        provider_terminal_id,provider_card_id_hash,checkout_expires_at
      ) values (
        ${session.userId},${subscription.id},${method.id},${body.requestId},'addon',
        ${product.code},${product.priceKrw},${orderId},${orderName},'thepayone',${orderId},
        ${merchantId},${terminalId},${cardTokenHash(cardId)},now()+interval '10 minutes'
      ) on conflict (request_id) do nothing returning *
    `;
    const order = inserted[0] || (await db`
      select * from shorts_mvp.billing_orders
      where request_id=${body.requestId} and user_id=${session.userId} and kind='addon'
      limit 1
    `)[0];
    if (!order) throw new HttpError(409, "추가 시간 주문 ID가 이미 사용되었습니다.");
    billingOrderId = order.id;
    if (order.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        orderId: order.orderId,
        addedMinutes: Math.floor(product.seconds / 60),
        chargedAmountKrw: Number(order.amountKrw),
        alreadyProcessed: true,
      });
    }
    if (order.status !== "pending" || !order.checkoutExpiresAt || order.checkoutExpiresAt <= new Date()) {
      throw new HttpError(409, "추가 시간 주문이 만료되었거나 이미 처리되었습니다.");
    }
    const claimed = await db`
      update shorts_mvp.billing_orders set status='processing'
      where id=${order.id} and status='pending' returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 결제를 처리하고 있습니다.");
    claimedOrder = true;

    const attempts = await db`
      insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
      values (${order.id},1,${order.orderId})
      on conflict (order_id,attempt_no) do nothing returning id
    `;
    billingAttemptId = attempts[0]?.id || null;
    if (!billingAttemptId) throw new HttpError(409, "같은 결제가 이미 처리 중입니다.");

    const payment = await chargeThePayOneCard({
      trackId: order.orderId,
      cardId,
      authDob: body.identityNumber,
      authPw: body.cardPassword,
      amount: Number(order.amountKrw),
      payerName: (session.user.displayName || session.user.email.split("@", 1)[0] || "Easy Cut 고객").slice(0, 20),
      payerEmail: session.user.email,
      payerTel,
      billingDay: "00",
      productName: orderName,
      description: "추가 처리시간 90일 이용권",
      referenceId: order.id,
    });
    providerPaymentCompleted = true;
    if (
      payment.trackId !== order.orderId
      || payment.amount !== Number(order.amountKrw)
      || payment.cardId !== cardId
      || payment.terminalId !== terminalId
    ) {
      throw new ThePayOneError(
        "추가 시간 결제 승인 결과가 주문 정보와 일치하지 않습니다.",
        "PAYMENT_MISMATCH",
        null,
        true,
      );
    }

    await db.begin(async (tx) => {
      const locked = await tx`
        select o.*,s.status as subscription_status,s.current_period_end
        from shorts_mvp.billing_orders o
        join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
        where o.id=${order.id} for update of o
      `;
      const current = locked[0];
      if (!current) throw new HttpError(409, "추가 시간 주문을 찾을 수 없습니다.");
      if (current.status === "succeeded") return;
      if (current.status !== "processing") {
        throw new HttpError(409, "추가 시간 주문 상태가 변경되었습니다.");
      }
      if (current.subscriptionStatus !== "active" || current.currentPeriodEnd <= new Date()) {
        throw new HttpError(402, "활성 구독이 필요합니다.");
      }
      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,subscription_id,billing_order_id,kind,product_code,
          total_seconds,credited_seconds,carried_seconds,valid_from,expires_at
        ) values (
          ${session.userId},${subscription.id},${order.id},'addon',${product.code},
          ${product.seconds},${product.seconds},0,now(),now()+${product.validityDays}*interval '1 day'
        ) on conflict (billing_order_id) where kind='addon' do nothing
      `;
      await tx`
        update shorts_mvp.billing_orders
        set status='succeeded',provider_transaction_id=${payment.providerTransactionId},
          provider_status='paid',provider_terminal_id=${payment.terminalId},
          approved_at=${payment.approvedAt},failure_code=null,failure_message=null
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',provider_transaction_id=${payment.providerTransactionId},
          finished_at=now()
        where id=${billingAttemptId}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},subscription_id=${subscription.id},
          payment_method_id=${method.id},validation_status='processed',
          processing_result='addon_server_payment_reconciled',processed_at=now()
        where provider='thepayone' and provider_transaction_id=${payment.providerTransactionId}
          and validation_status in ('received','validated')
      `;
    });

    return NextResponse.json({
      ok: true,
      orderId: order.orderId,
      addedMinutes: Math.floor(product.seconds / 60),
      chargedAmountKrw: Number(order.amountKrw),
    });
  } catch (error) {
    const unknown = providerPaymentCompleted || (error instanceof ThePayOneError && error.outcomeUnknown);
    const failureMessage = safeFailureMessage(error);
    if (billingOrderId && claimedOrder) {
      try {
        const code = error instanceof ThePayOneError
          ? error.resultCode
          : error instanceof HttpError ? error.code : "ADDON_PURCHASE_FAILED";
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.billing_orders
            set status=${unknown ? "manual_review" : "failed"},failure_code=${code},
              failure_message=${failureMessage}
            where id=${billingOrderId} and status in ('pending','processing')
          `;
          if (billingAttemptId) await tx`
            update shorts_mvp.billing_attempts
            set status=${unknown ? "unknown" : "failed"},provider_code=${code},finished_at=now()
            where id=${billingAttemptId} and status='processing'
          `;
        });
      } catch {
        // Preserve the original provider outcome for later reconciliation.
      }
    }
    if (error instanceof ThePayOneError) {
      console.error("thepayone_addon_saved_card_payment_failed", {
        billingOrderId,
        resultCode: error.resultCode,
        outcomeUnknown: error.outcomeUnknown,
        diagnostic: error.diagnostic,
      });
      if (failureMessage) {
        return apiError(
          new HttpError(400, failureMessage, "THEPAYONE_REJECTED"),
          "추가 시간 결제를 완료하지 못했습니다.",
        );
      }
    }
    return apiError(error, "추가 시간 결제를 완료하지 못했습니다.");
  }
}
