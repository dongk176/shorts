import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import {
  BILLING_CARD_VERIFICATION_TTL_MINUTES,
  type BillingCardVerification,
} from "@/lib/billing-card-verifications";
import { resolveStoredCardIssuer } from "@/lib/billing-card";
import { assertPricingV2PackagePurchaseAvailable } from "@/lib/billing";
import { billingCycles, paidPlanCodes } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  getPricingV2Plan,
  isPricingV2PlanCode,
} from "@/lib/pricing-v2";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  createPaymentTrackId,
  encryptCardToken,
  isSupportedCardNumber,
  normalizeCardNumber,
  PaymentConfigurationError,
  registerThePayOneCard,
  thePayOneCredentialScopeForPackage,
  thePayOneMerchantId,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  mode: z.enum(["subscribe", "change_subscription"]),
  planCode: z.enum(paidPlanCodes),
  billingCycle: z.enum(billingCycles),
  payerName: z.string().trim().min(1).max(20),
  payerEmail: z.string().trim().email().max(100),
  payerTel: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{10,11}$/.test(value)),
  cardNumber: z.string().transform(normalizeCardNumber).refine(isSupportedCardNumber),
  expiryYear: z.string().refine((value) => /^\d{2}$/.test(value)),
  expiryMonth: z.string().refine((value) => /^(0[1-9]|1[0-2])$/.test(value)),
  identityNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
}).strict().superRefine((value, context) => {
  const now = new Date();
  const currentYear = now.getUTCFullYear() % 100;
  const currentMonth = now.getUTCMonth() + 1;
  const year = Number(value.expiryYear);
  const month = Number(value.expiryMonth);
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    context.addIssue({
      code: "custom",
      path: ["expiryMonth"],
      message: "카드 유효기간을 확인해 주세요.",
    });
  }
});

type CurrentSubscription = {
  planCode: string;
  status: string;
};

function safeVerification(row: BillingCardVerification) {
  return {
    id: row.id,
    issuer: row.issuerName,
    cardType: row.cardType,
    last4: row.cardLast4,
    expiresAt: row.expiresAt.toISOString(),
  };
}

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function verificationError(error: unknown) {
  if (error instanceof ThePayOneError) {
    console.error("thepayone_card_verification_failed", {
      resultCode: error.resultCode,
      outcomeUnknown: error.outcomeUnknown,
    });
    return apiError(new HttpError(
      error.outcomeUnknown ? 502 : 400,
      error.outcomeUnknown
        ? "카드 인증 결과를 확인하지 못했습니다. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요."
        : "카드번호, 유효기간, 생년월일·사업자번호와 카드 비밀번호 앞 2자리를 다시 확인해 주세요.",
      error.outcomeUnknown
        ? "CARD_VERIFICATION_OUTCOME_UNKNOWN"
        : "CARD_VERIFICATION_FAILED",
    ));
  }
  if (error instanceof PaymentConfigurationError) return apiError(error);
  if (error instanceof z.ZodError) {
    return apiError(new HttpError(
      400,
      error.issues[0]?.message || "카드 인증 입력값을 다시 확인해 주세요.",
      "CARD_VERIFICATION_INPUT_INVALID",
    ));
  }
  return apiError(error, "카드를 확인하지 못했습니다.");
}

export async function POST(request: Request) {
  let verificationId: string | null = null;
  let userId: string | null = null;
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const input = schema.parse(await request.json());
    if (!isPricingV2PlanCode(input.planCode)) {
      throw new HttpError(410, "현재 판매 중인 상품을 다시 선택해 주세요.");
    }
    const product = getPricingV2Plan(input.planCode);
    if (!product || product.billingCycle !== input.billingCycle) {
      throw new HttpError(409, "선택한 상품의 결제 방식을 확인해 주세요.");
    }
    if (product.kind === "package") {
      throw new HttpError(
        409,
        "패키지 결제 화면이 업데이트되었습니다. 페이지를 새로고침한 뒤 카드 정보를 다시 입력해 주세요.",
        "PACKAGE_MANUAL_DIRECT_REQUIRED",
      );
    }
    const credentialScope = thePayOneCredentialScopeForPackage(
      false,
    );
    const merchantId = thePayOneMerchantId(credentialScope);
    const terminalId = thePayOneTerminalId(credentialScope);

    const session = await requireAuthenticatedMvpSession();
    userId = session.userId;
    const db = getDb();
    await assertPricingV2PackagePurchaseAvailable(
      db,
      session.userId,
      input.planCode,
      input.requestId,
    );
    const currentRows = await db`
      select plan_code,status
      from shorts_mvp.user_subscriptions
      where user_id=${session.userId}
        and status in ('trialing','active','past_due')
      order by created_at desc
      limit 1
    ` as unknown as CurrentSubscription[];
    const current = currentRows[0] || null;
    if (input.mode === "subscribe" && current) {
      throw new HttpError(409, "이미 이용 중인 상품이 있습니다. 요금제 변경 절차를 이용해 주세요.");
    }
    if (input.mode === "change_subscription" && !current) {
      throw new HttpError(409, "변경하거나 갱신할 이용권을 찾을 수 없습니다.");
    }

    const existingRows = await db`
      select *
      from shorts_mvp.billing_card_verifications
      where user_id=${session.userId} and request_id=${input.requestId}
      limit 1
    ` as unknown as BillingCardVerification[];
    const existing = existingRows[0];
    if (existing) {
      const matchesCheckout = existing.mode === input.mode
        && existing.planCode === input.planCode
        && existing.billingCycle === input.billingCycle
        && (
          existing.providerCredentialScope === null
          || (
            existing.providerCredentialScope === credentialScope
            && existing.providerMerchantId === merchantId
            && existing.providerTerminalId === terminalId
          )
        );
      if (
        existing.status === "active"
        && existing.expiresAt > new Date()
        && matchesCheckout
      ) {
        return json({ verification: safeVerification(existing), duplicate: true });
      }
      if (existing.status === "pending") {
        throw new HttpError(409, "카드를 확인하고 있습니다. 잠시만 기다려 주세요.", "CARD_VERIFICATION_PENDING");
      }
      throw new HttpError(
        409,
        "이 카드 확인 요청은 더 이상 사용할 수 없습니다. 다시 시도해 주세요.",
        "CARD_VERIFICATION_RETRY_REQUIRED",
      );
    }

    verificationId = randomUUID();
    const providerOrderId = createPaymentTrackId("AUTH");
    // The first step only verifies the card. A separate final cardId is issued
    // with the actual billing day after the payer confirms the purchase.
    const billingDay = "00";
    const inserted = await db`
      insert into shorts_mvp.billing_card_verifications (
        id,user_id,request_id,mode,plan_code,billing_cycle,billing_day,
        provider_order_id,provider_credential_scope,provider_merchant_id,
        provider_terminal_id,status,expires_at
      ) values (
        ${verificationId},${session.userId},${input.requestId},${input.mode},
        ${input.planCode},${input.billingCycle},${billingDay},
        ${providerOrderId},${credentialScope},${merchantId},${terminalId},'pending',
        clock_timestamp()+${BILLING_CARD_VERIFICATION_TTL_MINUTES}*interval '1 minute'
      )
      on conflict (request_id) do nothing
      returning id
    `;
    if (!inserted[0]) {
      throw new HttpError(409, "같은 카드 확인 요청이 처리 중입니다.", "CARD_VERIFICATION_PENDING");
    }

    let issued;
    try {
      issued = await registerThePayOneCard({
        trackId: providerOrderId,
        amount: 0,
        payerName: input.payerName,
        payerEmail: input.payerEmail,
        payerTel: input.payerTel,
        cardNumber: input.cardNumber,
        expiry: `${input.expiryYear}${input.expiryMonth}`,
        authDob: input.identityNumber,
        authPw: input.cardPassword,
        billingDay,
        productName: `${product.displayName} 카드 확인`,
      }, credentialScope);
    } catch (error) {
      await db`
        update shorts_mvp.billing_card_verifications
        set status=${error instanceof ThePayOneError && error.outcomeUnknown ? "unknown" : "failed"},
          provider_result_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"}
        where id=${verificationId} and user_id=${session.userId} and status='pending'
      `;
      throw error;
    }

    if (
      issued.trackId !== providerOrderId
      || issued.amount !== 0
      || issued.billingDay !== billingDay
    ) {
      await db`
        update shorts_mvp.billing_card_verifications
        set status='unknown',provider_result_code=${issued.resultCode}
        where id=${verificationId} and user_id=${session.userId} and status='pending'
      `;
      throw new ThePayOneError(
        "카드 인증 결과가 요청 정보와 일치하지 않습니다.",
        "CARD_VERIFICATION_MISMATCH",
        null,
        true,
      );
    }

    const encrypted = encryptCardToken(issued.cardId, verificationId);
    const rows = await db`
      update shorts_mvp.billing_card_verifications
      set status='active',provider_transaction_id=${issued.providerTransactionId},
        provider_result_code=${issued.resultCode},
        billing_key_ciphertext=${encrypted.ciphertext},
        billing_key_iv=${encrypted.iv},billing_key_tag=${encrypted.tag},
        billing_key_hash=${cardTokenHash(issued.cardId)},
        issuer_name=${resolveStoredCardIssuer({
          issuer: issued.issuer,
          acquirer: issued.acquirer,
          cardNumberMasked: input.cardNumber,
        })},card_type=${issued.cardType},
        acquirer_name=${issued.acquirer},card_last4=${issued.last4}
      where id=${verificationId} and user_id=${session.userId} and status='pending'
      returning *
    ` as unknown as BillingCardVerification[];
    if (!rows[0]) {
      throw new ThePayOneError(
        "카드 인증 상태를 저장하지 못했습니다.",
        "CARD_VERIFICATION_STORAGE_FAILED",
        null,
        true,
      );
    }
    return json({ verification: safeVerification(rows[0]) }, { status: 201 });
  } catch (error) {
    if (
      verificationId
      && userId
      && !(error instanceof ThePayOneError)
    ) {
      await getDb()`
        update shorts_mvp.billing_card_verifications
        set status='failed',provider_result_code=coalesce(provider_result_code,'LOCAL_ERROR')
        where id=${verificationId} and user_id=${userId} and status='pending'
      `.catch(() => undefined);
    }
    return verificationError(error);
  }
}
