import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { billingCycles, paidPlanCodes, type BillingCycle } from "@/lib/contracts";
import {
  addKstMonths,
  assertPricingV2PackagePurchaseAvailable,
  createBaseUsageGrant,
  createBillingOrderId,
  getPaidPlan,
  syncCachedPlan,
  type PaidPlanProduct,
} from "@/lib/billing";
import {
  classifySubscriptionChange,
  monthlyUpgradeBaseGrantSeconds,
  quoteSubscriptionChange,
  type SubscriptionChangeQuote,
} from "@/lib/billing-change";
import { resolveStoredCardIssuer } from "@/lib/billing-card";
import {
  decryptBillingPhone,
  encryptBillingPhone,
} from "@/lib/billing-phone";
import type { BillingCardVerification } from "@/lib/billing-card-verifications";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import {
  getDefaultPaymentMethodId,
  setDefaultPaymentMethod,
} from "@/lib/default-payment-method";
import { apiError, HttpError } from "@/lib/http";
import {
  installmentIssuerCodes,
  installmentResponseMatchesSelection,
  validateInstallmentSelection,
} from "@/lib/installments";
import {
  assertLocalManualCheckoutAccess,
  assertManualPaymentAvailable,
  oneTimePaymentMode,
} from "@/lib/manual-payment-routing";
import {
  canStackPricingV2Package,
  getPricingV2Plan,
  isEasycutProPackageReplacement,
  isPricingV2PackageCode,
  isPricingV2PlanCode,
} from "@/lib/pricing-v2";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  changeThePayOneCardStatus,
  chargeThePayOneCard,
  chargeThePayOneManualCard,
  createPaymentTrackId,
  decryptCardToken,
  encryptCardToken,
  refundThePayOnePayment,
  registerThePayOneCard,
  revokeThePayOneCard,
  thePayOneCardTypeAllowsInstallment,
  thePayOneCardTypeMatchesDeclaredKind,
  thePayOneInstallmentMaxMonths,
  thePayOneRefundMismatchFields,
  thePayOneMerchantId,
  thePayOneTerminalId,
  type ThePayOneCredentialScope,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cardAuthFields = {
  identityNumber: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
};

const cardFields = {
  payerName: z.string().trim().min(1).max(20),
  payerEmail: z.string().trim().email().max(100),
  payerTel: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^\d{10,11}$/.test(value)),
  cardNumber: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^\d{13,19}$/.test(value)),
  expiryYear: z.string().refine((value) => /^\d{2}$/.test(value)),
  expiryMonth: z.string().refine((value) => /^(0[1-9]|1[0-2])$/.test(value)),
  cardVerificationId: z.string().uuid().optional(),
  declaredCardKind: z.enum(["credit", "debit_prepaid"]).optional(),
  ...cardAuthFields,
};

const installmentFields = {
  installmentMonths: z.number().int().min(0).max(36).refine((value) => value !== 1).default(0),
  installmentCampaignId: z.string().uuid().nullable().optional(),
  installmentIssuerCode: z.enum(installmentIssuerCodes).nullable().optional(),
};

const savedCardFields = {
  expectedChargeAmountKrw: z.number().int().nonnegative(),
  payerTel: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{10,11}$/.test(value))
    .optional(),
  ...installmentFields,
  ...cardAuthFields,
};

const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("subscribe"),
    requestId: z.string().uuid(),
    planCode: z.enum(paidPlanCodes),
    billingCycle: z.enum(billingCycles),
    ...installmentFields,
    ...cardFields,
  }).strict(),
  z.object({
    mode: z.literal("subscribe_saved"),
    requestId: z.string().uuid(),
    planCode: z.enum(paidPlanCodes),
    billingCycle: z.enum(billingCycles),
    ...savedCardFields,
  }).strict(),
  z.object({
    mode: z.literal("change_subscription"),
    requestId: z.string().uuid(),
    planCode: z.enum(paidPlanCodes),
    billingCycle: z.enum(billingCycles),
    ...installmentFields,
    ...cardFields,
  }).strict(),
  z.object({
    mode: z.literal("change_subscription_saved"),
    requestId: z.string().uuid(),
    planCode: z.enum(paidPlanCodes),
    billingCycle: z.enum(billingCycles),
    expectedRefundAmountKrw: z.number().int().nonnegative().optional(),
    ...savedCardFields,
  }).strict(),
  z.object({
    mode: z.literal("replace_payment_method"),
    requestId: z.string().uuid(),
    ...installmentFields,
    ...cardFields,
  }).strict(),
  z.object({
    mode: z.literal("renew_annual"),
    requestId: z.string().uuid(),
    ...installmentFields,
    ...cardFields,
  }).strict(),
]);

function rejectRetiredAnnualRenewal(mode: string) {
  if (mode === "renew_annual") {
    throw new HttpError(410, "기존 연간 상품은 더 이상 갱신할 수 없습니다. 현재 요금제에서 기간 패키지를 선택해 주세요.");
  }
}

type CurrentSubscription = Record<string, unknown> & {
  id: string;
  userId: string;
  status: "active" | "past_due";
  planCode: string;
  billingCycle: BillingCycle;
  paymentMethodId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextQuotaAt: Date | null;
  billingAnchorDay: number | null;
  scheduledPlanCode: string | null;
  scheduledBillingCycle: BillingCycle | null;
};

type StoredMethod = Record<string, unknown> & {
  id: string;
  provider: string;
  status: string;
  providerScheduleStatus: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
  payerTelCiphertext: string | null;
  payerTelIv: string | null;
  payerTelTag: string | null;
  issuerName: string | null;
  cardLast4: string | null;
};

type RefundableCurrentPaymentOrder = Record<string, unknown> & {
  id: string;
  amountKrw: number;
  refundedAmountKrw: number;
  refundStatus: string;
  providerTransactionId: string;
  providerMerchantId: string;
  providerTerminalId: string;
  prorationRefundStatus: string;
  hasReservedRefund: boolean;
  approvedAt: Date;
  providerAuthCode: string | null;
  providerTransactionDay: Date | string | null;
};

function kstBillingDay(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return String(Math.min(kst.getUTCDate(), 28)).padStart(2, "0");
}

function kstTransactionDay(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function orderKind(mode: z.infer<typeof schema>["mode"], current: CurrentSubscription | null) {
  if (mode === "subscribe" || mode === "subscribe_saved") return "subscription_initial" as const;
  if (mode === "change_subscription" || mode === "change_subscription_saved") {
    return "subscription_change" as const;
  }
  if (mode === "renew_annual") return "annual_renewal" as const;
  return current?.status === "past_due" ? "subscription_renewal" as const : "payment_method_update" as const;
}

function orderPrefix(kind: ReturnType<typeof orderKind>) {
  if (kind === "subscription_initial") return "SUB" as const;
  if (kind === "payment_method_update") return "PM" as const;
  return "REN" as const;
}

async function currentSubscription(userId: string) {
  const rows = await getDb()`
    select * from shorts_mvp.user_subscriptions
    where user_id=${userId} and status in ('active','past_due')
    order by created_at desc limit 1
  `;
  return (rows[0] || null) as CurrentSubscription | null;
}

async function storedMethod(id: string | null | undefined, userId: string) {
  if (!id) return null;
  const rows = await getDb()`
    select * from shorts_mvp.billing_payment_methods
    where id=${id} and user_id=${userId}
    limit 1
  `;
  return (rows[0] || null) as StoredMethod | null;
}

async function currentMonthlyPaymentOrder(
  userId: string,
  subscription: CurrentSubscription,
) {
  const rows = await getDb()`
    select o.*,
      (
        exists (
        select 1 from shorts_mvp.admin_billing_refunds r
        where r.billing_order_id=o.id
          and r.status in ('pending','processing','succeeded','manual_review')
        )
        or exists (
        select 1 from shorts_mvp.subscription_upgrade_refunds ur
        where ur.source_order_id=o.id
          and ur.status in ('pending','submitted','manual_review')
        )
      ) as has_reserved_refund
    from shorts_mvp.billing_orders o
    where o.user_id=${userId} and o.subscription_id=${subscription.id}
      and o.status='succeeded' and o.provider='thepayone'
      and o.billing_cycle='monthly' and o.product_code=${subscription.planCode}
      and o.kind in ('subscription_initial','subscription_renewal','subscription_change')
      and o.provider_transaction_id is not null
    order by o.approved_at desc nulls last,o.created_at desc
    limit 1
  `;
  return (rows[0] || null) as RefundableCurrentPaymentOrder | null;
}

function cardIdFromMethod(method: StoredMethod) {
  if (method.provider !== "thepayone") {
    throw new HttpError(409, "기존 결제수단을 더페이원 카드로 먼저 교체해야 합니다.");
  }
  return decryptCardToken({
    ciphertext: method.billingKeyCiphertext,
    iv: method.billingKeyIv,
    tag: method.billingKeyTag,
  }, method.id);
}

function payerPhoneFromMethod(method: StoredMethod) {
  if (!method.payerTelCiphertext || !method.payerTelIv || !method.payerTelTag) return null;
  return decryptBillingPhone({
    ciphertext: method.payerTelCiphertext,
    iv: method.payerTelIv,
    tag: method.payerTelTag,
  }, method.id);
}

async function pauseOldSchedule(method: StoredMethod | null) {
  if (
    !method
    || method.provider !== "thepayone"
    || !["active", "manual_review"].includes(method.providerScheduleStatus)
  ) return true;
  try {
    await changeThePayOneCardStatus(cardIdFromMethod(method), "중지", createPaymentTrackId("AUDT"));
    return true;
  } catch {
    return false;
  }
}

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
  let paymentMethodId: string | null = null;
  let issuedCardId: string | null = null;
  let registrationTransactionId: string | null = null;
  let cardVerification: BillingCardVerification | null = null;
  let cardVerificationClaimed = false;
  let claimedOrder = false;
  let providerPaymentCompleted = false;
  let changeQuote: SubscriptionChangeQuote | null = null;
  let paymentCredentialScope: ThePayOneCredentialScope = "default";
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    rejectRetiredAnnualRenewal(body.mode);
    if (
      (body.mode === "subscribe"
        || body.mode === "subscribe_saved"
        || body.mode === "change_subscription"
        || body.mode === "change_subscription_saved")
      && !isPricingV2PlanCode(body.planCode)
    ) {
      throw new HttpError(410, "이 상품은 더 이상 판매하지 않습니다. 현재 요금제에서 상품을 다시 선택해 주세요.");
    }
    const startsSubscription = body.mode === "subscribe" || body.mode === "subscribe_saved";
    const reuseStoredMethod = body.mode === "subscribe_saved"
      || body.mode === "change_subscription_saved";
    const subscriptionChange = body.mode === "change_subscription"
      || body.mode === "change_subscription_saved";
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    if ("planCode" in body) {
      await assertPricingV2PackagePurchaseAvailable(
        db,
        session.userId,
        body.planCode,
        body.requestId,
      );
    }
    const existingCurrent = await currentSubscription(session.userId);
    const requestedPricingV2Plan = "planCode" in body
      ? getPricingV2Plan(body.planCode)
      : null;
    const stackingPackage = Boolean(
      startsSubscription
      && requestedPricingV2Plan?.kind === "package"
      && existingCurrent
      && canStackPricingV2Package(existingCurrent.planCode, body.planCode),
    );
    const current = stackingPackage ? null : existingCurrent;

    if (startsSubscription && existingCurrent && !stackingPackage) {
      throw new HttpError(409, "이미 구독이 있습니다. 플랜 변경 기능을 이용해 주세요.");
    }
    if (!startsSubscription && !current) {
      throw new HttpError(409, "변경하거나 갱신할 구독을 찾을 수 없습니다.");
    }
    if (body.mode === "renew_annual" && current?.billingCycle !== "yearly") {
      throw new HttpError(409, "연간 구독만 연간 갱신을 진행할 수 있습니다.");
    }
    let plan: PaidPlanProduct;
    let billingCycle: BillingCycle;
    if (startsSubscription || subscriptionChange) {
      plan = await getPaidPlan(db, body.planCode);
      billingCycle = body.billingCycle;
    } else {
      plan = await getPaidPlan(db, current!.planCode);
      billingCycle = current!.billingCycle;
    }
    const pricingV2Plan = getPricingV2Plan(plan.code);
    const replacesEasycutPro = Boolean(
      subscriptionChange
      && current
      && isEasycutProPackageReplacement(current.planCode, plan.code),
    );
    if (pricingV2Plan && pricingV2Plan.billingCycle !== billingCycle) {
      throw new HttpError(
        409,
        pricingV2Plan.kind === "subscription"
          ? "이지컷 프로는 월간 자동결제로만 구매할 수 있습니다."
          : "패키지는 선택한 기간을 한 번 결제하는 상품입니다.",
        "INVALID_BILLING_CYCLE",
      );
    }
    const isPackageProduct = pricingV2Plan?.kind === "package";
    const packagePaymentMode = isPackageProduct
      ? oneTimePaymentMode("package")
      : "legacy";
    if (isPackageProduct && packagePaymentMode === "disabled") {
      throw new HttpError(
        503,
        "패키지 결제가 현재 중지되어 있습니다.",
        "PACKAGE_MANUAL_BILLING_DISABLED",
      );
    }
    const isManualPackage = isPackageProduct && packagePaymentMode === "manual";
    const localManualCheckout = isManualPackage
      ? assertLocalManualCheckoutAccess(request, session, { mutation: true })
      : false;
    if (isManualPackage) {
      await assertManualPaymentAvailable(db, "package", {
        localManualCheckout,
      });
      paymentCredentialScope = "manual";
    } else {
      paymentCredentialScope = "default";
    }
    const merchantId = thePayOneMerchantId(paymentCredentialScope);
    const expectedTerminalId = thePayOneTerminalId(paymentCredentialScope);
    if (isManualPackage && reuseStoredMethod) {
      throw new HttpError(
        409,
        "패키지 결제 화면이 업데이트되었습니다. 페이지를 새로고침한 뒤 새 카드 정보를 입력해 주세요.",
        "PACKAGE_MANUAL_CARD_REQUIRED",
      );
    }
    if (isManualPackage && !("cardNumber" in body)) {
      throw new HttpError(
        409,
        "패키지 결제 화면이 업데이트되었습니다. 페이지를 새로고침한 뒤 새 카드 정보를 입력해 주세요.",
        "PACKAGE_MANUAL_CARD_REQUIRED",
      );
    }
    if (isManualPackage && body.mode === "replace_payment_method") {
      throw new HttpError(
        409,
        "패키지는 자동결제 카드 변경 대상이 아닙니다.",
        "PACKAGE_PAYMENT_METHOD_NOT_APPLICABLE",
      );
    }
    const manualPackageCard = isManualPackage && "cardNumber" in body
      ? {
        cardNumber: body.cardNumber,
        expiry: `${body.expiryYear}${body.expiryMonth}`,
        authDob: body.identityNumber,
        authPw: body.cardPassword,
        payerName: body.payerName,
        payerEmail: body.payerEmail,
        payerTel: body.payerTel,
      }
      : null;
    const calculationTime = new Date();
    let currentPaymentToRefund: RefundableCurrentPaymentOrder | null = null;
    if (subscriptionChange) {
      const due = current!.status === "past_due" || current!.currentPeriodEnd <= calculationTime;
      if (due) {
        if (
          current!.scheduledPlanCode
          && (current!.scheduledPlanCode !== body.planCode || current!.scheduledBillingCycle !== body.billingCycle)
        ) throw new HttpError(409, "예약된 플랜과 결제 요청이 일치하지 않습니다.");
      } else {
        const currentPlan = await getPaidPlan(db, current!.planCode);
        const action = classifySubscriptionChange({
          currentPlanCode: current!.planCode as PaidPlanProduct["code"],
          currentBillingCycle: current!.billingCycle,
          targetPlanCode: plan.code,
          targetBillingCycle: billingCycle,
        });
        if (action !== "immediate_proration" && action !== "immediate_annual_conversion") {
          throw new HttpError(409, "이 변경은 현재 결제기간 종료일에 예약해야 합니다.", "SUBSCRIPTION_CHANGE_MUST_BE_SCHEDULED");
        }
        if (current!.billingCycle === "monthly") {
          currentPaymentToRefund = await currentMonthlyPaymentOrder(session.userId, current!);
        }
        if (replacesEasycutPro && !currentPaymentToRefund) {
          throw new HttpError(
            409,
            "기존 이지컷 프로 결제의 전액 환불 가능 상태를 확인하지 못했습니다. 고객센터로 문의해 주세요.",
            "CURRENT_PAYMENT_NOT_REFUNDABLE",
          );
        }
        changeQuote = quoteSubscriptionChange({
          currentPlanCode: current!.planCode as PaidPlanProduct["code"],
          currentBillingCycle: current!.billingCycle,
          currentPlan,
          targetPlanCode: plan.code,
          targetBillingCycle: billingCycle,
          targetPlan: plan,
          currentPeriodStart: current!.currentPeriodStart,
          currentPeriodEnd: current!.currentPeriodEnd,
          now: calculationTime,
          monthlyPeriodEnd: addKstMonths(calculationTime, 1),
          annualPeriodEnd: addKstMonths(calculationTime, plan.prepaidMonths),
          sourcePaymentAmountKrw: currentPaymentToRefund
            ? Number(currentPaymentToRefund.amountKrw)
            : undefined,
          sourcePaymentApprovedAt: currentPaymentToRefund?.approvedAt,
        });
      }
    }

    const kind = orderKind(body.mode, current);
    const chargeNow = kind !== "payment_method_update";
    const regularChargeAmount = billingCycle === "yearly" ? plan.yearlyPriceKrw : plan.monthlyPriceKrw;
    const quotedChargeAmount = changeQuote?.providerChargeAmountKrw ?? regularChargeAmount;
    const quotedProrationCreditKrw = changeQuote?.prorationCreditKrw ?? 0;
    const customerVisibleChargeAmount = changeQuote?.chargeAmountKrw ?? regularChargeAmount;
    if (changeQuote && changeQuote.refundMode !== "none") {
      if (
        !currentPaymentToRefund
        || changeQuote.refundAmountKrw !== quotedProrationCreditKrw
        || Number(currentPaymentToRefund.refundedAmountKrw) !== 0
        || currentPaymentToRefund.refundStatus !== "none"
        || currentPaymentToRefund.prorationRefundStatus !== "none"
        || currentPaymentToRefund.hasReservedRefund
        || currentPaymentToRefund.providerMerchantId !== thePayOneMerchantId()
        || currentPaymentToRefund.providerTerminalId !== thePayOneTerminalId()
      ) {
        throw new HttpError(
          409,
          "기존 월간 결제의 환불 가능 상태를 확인하지 못했습니다. 고객센터로 문의해 주세요.",
          "CURRENT_PAYMENT_NOT_REFUNDABLE",
        );
      }
    }
    if (reuseStoredMethod && body.expectedChargeAmountKrw !== customerVisibleChargeAmount) {
      throw new HttpError(
        409,
        "확인한 뒤 결제 금액이 변경되었습니다. 금액을 다시 확인해 주세요.",
        "PAYMENT_QUOTE_CHANGED",
      );
    }
    if (
      body.mode === "change_subscription_saved"
      && body.expectedRefundAmountKrw !== undefined
      && body.expectedRefundAmountKrw !== (changeQuote?.refundAmountKrw || 0)
    ) {
      throw new HttpError(
        409,
        "확인한 뒤 예상 환불 금액이 변경되었습니다. 금액을 다시 확인해 주세요.",
        "PAYMENT_QUOTE_CHANGED",
      );
    }
    const defaultPaymentMethodId = reuseStoredMethod
      ? await getDefaultPaymentMethodId(db, session.userId)
      : null;
    const existingMethod = await storedMethod(
      reuseStoredMethod
        ? defaultPaymentMethodId || existingCurrent?.paymentMethodId
        : current?.paymentMethodId,
      session.userId,
    );
    const requestedCardVerificationId = "cardVerificationId" in body
      ? body.cardVerificationId
      : undefined;
    if (isManualPackage && requestedCardVerificationId) {
      throw new HttpError(
        409,
        "패키지 결제 화면이 업데이트되었습니다. 페이지를 새로고침한 뒤 새 카드 정보를 입력해 주세요.",
        "PACKAGE_MANUAL_DIRECT_REQUIRED",
      );
    }
    if (requestedCardVerificationId) {
      const verificationRows = await db`
        select *
        from shorts_mvp.billing_card_verifications
        where id=${requestedCardVerificationId} and user_id=${session.userId}
        limit 1
      ` as unknown as BillingCardVerification[];
      cardVerification = verificationRows[0] || null;
      if (!cardVerification) {
        throw new HttpError(
          409,
          "확인된 카드 정보를 찾을 수 없습니다. 카드를 다시 확인해 주세요.",
          "CARD_VERIFICATION_REQUIRED",
        );
      }
      if (
        cardVerification.mode !== body.mode
        || !("planCode" in body)
        || cardVerification.planCode !== body.planCode
        || cardVerification.billingCycle !== billingCycle
        || (
          cardVerification.providerCredentialScope !== null
          && (
            cardVerification.providerCredentialScope !== paymentCredentialScope
            || cardVerification.providerMerchantId !== merchantId
            || cardVerification.providerTerminalId !== expectedTerminalId
          )
        )
      ) {
        throw new HttpError(
          409,
          "카드 확인 정보와 결제 상품이 일치하지 않습니다. 카드를 다시 확인해 주세요.",
          "CARD_VERIFICATION_MISMATCH",
        );
      }
      if (
        cardVerification.status !== "active"
        || cardVerification.expiresAt <= calculationTime
        || !cardVerification.billingKeyCiphertext
        || !cardVerification.billingKeyIv
        || !cardVerification.billingKeyTag
      ) {
        throw new HttpError(
          409,
          "카드 확인 시간이 만료되었거나 이미 사용되었습니다. 카드를 다시 확인해 주세요.",
          "CARD_VERIFICATION_EXPIRED",
        );
      }
      if (
        cardVerification.cardLast4
        && "cardNumber" in body
        && body.cardNumber.slice(-4) !== cardVerification.cardLast4
      ) {
        throw new HttpError(
          409,
          "확인한 카드와 입력된 카드번호가 다릅니다. 카드를 다시 확인해 주세요.",
          "CARD_VERIFICATION_MISMATCH",
        );
      }
    }
    const requestedInstallmentMonths = "installmentMonths" in body
      ? body.installmentMonths
      : 0;
    const requestedCampaignId = "installmentCampaignId" in body
      ? body.installmentCampaignId
      : null;
    const requestedInstallmentIssuer = "installmentIssuerCode" in body
      ? body.installmentIssuerCode
      : null;
    const declaredCardKind = "declaredCardKind" in body
      ? body.declaredCardKind
      : undefined;
    if (isManualPackage && !declaredCardKind) {
      throw new HttpError(
        409,
        "카드 종류를 다시 선택해 주세요.",
        "MANUAL_CARD_KIND_REQUIRED",
      );
    }
    if (
      isManualPackage
      && declaredCardKind === "debit_prepaid"
      && requestedInstallmentMonths > 0
    ) {
      throw new HttpError(
        409,
        "체크·선불카드는 일시불로만 결제할 수 있습니다.",
        "DEBIT_CARD_INSTALLMENT_NOT_ALLOWED",
      );
    }
    const installment = await validateInstallmentSelection(db, {
      billingCycle,
      amountKrw: quotedChargeAmount,
      installmentMonths: requestedInstallmentMonths,
      campaignId: requestedCampaignId,
      productKind: pricingV2Plan?.kind || "subscription",
      credentialScope: paymentCredentialScope,
      localManualCheckout,
      issuer: isManualPackage
        ? requestedInstallmentIssuer
        : cardVerification
          ? cardVerification.issuerName
          : reuseStoredMethod
            ? existingMethod?.issuerName ?? null
            : undefined,
    });
    const resetsMonthlyBillingPeriod = Boolean(changeQuote?.startsNewBillingPeriod);
    const periodBase = resetsMonthlyBillingPeriod
      ? calculationTime
      : current?.currentPeriodEnd && current.currentPeriodEnd > calculationTime
      ? current.currentPeriodEnd
      : calculationTime;
    const billingDay = billingCycle === "monthly" ? kstBillingDay(periodBase) : "00";
    if (cardVerification && cardVerification.billingDay !== "00") {
      throw new HttpError(
        409,
        "임시 카드 확인 정보가 올바르지 않습니다. 카드를 다시 확인해 주세요.",
        "CARD_VERIFICATION_BILLING_DAY_CHANGED",
      );
    }
    const orderId = createBillingOrderId(orderPrefix(kind));
    const orderName = kind === "payment_method_update"
      ? "Easy Cut 정기결제 카드 변경"
      : pricingV2Plan?.kind === "package"
        ? `Easy Cut ${plan.displayName}`
        : `Easy Cut ${plan.displayName} ${billingCycle === "yearly" ? "연간" : "월간"} 구독`;
    const inserted = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,request_id,kind,product_code,billing_cycle,
        amount_krw,order_id,order_name,provider,provider_track_id,
        provider_merchant_id,provider_terminal_id,renewal_period_start,checkout_expires_at,
        proration_credit_krw,installment_months,installment_campaign_id,installment_terms_snapshot,
        purchase_limit_version
      ) values (
        ${session.userId},${current?.id || null},${body.requestId},${kind},${plan.code},${billingCycle},
        ${chargeNow ? quotedChargeAmount : 0},${orderId},${orderName},'thepayone',${orderId},
        ${merchantId},${expectedTerminalId},${kind === "subscription_renewal" ? current?.currentPeriodEnd || null : null},
        now()+interval '10 minutes',${quotedProrationCreditKrw},
        ${requestedInstallmentMonths},${installment.campaignId},${db.json((
          isManualPackage
            ? { ...installment.snapshot, declaredCardKind }
            : installment.snapshot
        ) as never)},
        ${pricingV2Plan?.kind === "package" ? 1 : 0}
      ) on conflict do nothing returning *
    `;
    const order = inserted[0] || (await db`
      select * from shorts_mvp.billing_orders
      where user_id=${session.userId} and request_id=${body.requestId} limit 1
    `)[0];
    if (!order) {
      await assertPricingV2PackagePurchaseAvailable(
        db,
        session.userId,
        plan.code,
        body.requestId,
      );
      throw new HttpError(409, "결제 요청 ID가 이미 사용되었습니다.");
    }
    billingOrderId = order.id;
    const chargeAmount = Number(order.amountKrw);
    const prorationCreditKrw = Number(order.prorationCreditKrw || 0);
    const needsCurrentPaymentFullRefund = Boolean(
      chargeNow
      && subscriptionChange
      && current?.status === "active"
      && current.currentPeriodEnd > calculationTime
      && current.billingCycle === "monthly"
      && changeQuote?.fullCurrentPaymentRefund
      && currentPaymentToRefund
      && prorationCreditKrw > 0,
    );
    const finalChargeAmount = chargeAmount;
    if (order.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        checkoutId: order.id,
        orderId: order.orderId,
        refund: {
          mode: changeQuote?.refundMode || "none",
          amountKrw: changeQuote?.refundAmountKrw || Number(order.prorationCreditKrw || 0),
          processingBusinessDays: changeQuote?.refundMode === "manual_partial" ? 3 : 0,
        },
        installmentMonths: Number(order.installmentMonths || 0),
        alreadyProcessed: true,
      });
    }
    if (order.status !== "pending" || !order.checkoutExpiresAt || order.checkoutExpiresAt <= new Date()) {
      throw new HttpError(409, "결제 요청이 만료되었거나 이미 처리되었습니다.");
    }
    const claimed = await db`
      update shorts_mvp.billing_orders set status='processing'
      where id=${order.id} and status='pending' returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 결제를 처리하고 있습니다.");
    claimedOrder = true;

    const oldMethod = existingMethod;
    let chargeCardId = "";
    let payerName: string;
    let payerEmail: string;
    let payerTel: string;
    if (reuseStoredMethod) {
      if (
        !oldMethod
        || oldMethod.provider !== "thepayone"
        || ["disposed", "manual_review", "replaced", "revoked"].includes(oldMethod.status)
      ) {
        throw new HttpError(
          409,
          "저장된 결제수단을 사용할 수 없습니다. 결제수단을 변경해 주세요.",
          "PAYMENT_METHOD_REQUIRED",
        );
      }
      if (!session.user?.email) {
        throw new HttpError(409, "결제에 사용할 계정 이메일을 확인할 수 없습니다.");
      }
      paymentMethodId = oldMethod.id;
      chargeCardId = cardIdFromMethod(oldMethod);
      payerName = (session.user.displayName || session.user.email.split("@", 1)[0] || "Easy Cut 고객").slice(0, 20);
      payerEmail = session.user.email;
      const storedPayerTel = payerPhoneFromMethod(oldMethod);
      if (storedPayerTel) {
        payerTel = storedPayerTel;
      } else {
        if (!body.payerTel) {
          throw new HttpError(
            409,
            "기존 결제정보에 휴대전화 번호가 없어 한 번만 입력이 필요합니다.",
            "PAYER_TEL_REQUIRED",
          );
        }
        payerTel = body.payerTel;
        const encryptedPhone = encryptBillingPhone(payerTel, oldMethod.id);
        await db`
          update shorts_mvp.billing_payment_methods
          set payer_tel_ciphertext=${encryptedPhone.ciphertext},
            payer_tel_iv=${encryptedPhone.iv},payer_tel_tag=${encryptedPhone.tag}
          where id=${oldMethod.id} and user_id=${session.userId}
            and payer_tel_ciphertext is null and payer_tel_iv is null and payer_tel_tag is null
        `;
      }
    } else {
      payerName = body.payerName;
      payerEmail = body.payerEmail;
      payerTel = body.payerTel;
      if (!isManualPackage) {
        paymentMethodId = randomUUID();
      }
      if (!isManualPackage && cardVerification) {
        const verifiedCard = cardVerification;
        const claimedVerifications = await db`
          update shorts_mvp.billing_card_verifications
          set status='consuming'
          where id=${verifiedCard.id} and user_id=${session.userId}
            and status='active' and expires_at > clock_timestamp()
          returning id
        `;
        if (!claimedVerifications[0]) {
          throw new HttpError(
            409,
            "카드 확인 시간이 만료되었거나 다른 결제에서 사용 중입니다. 카드를 다시 확인해 주세요.",
            "CARD_VERIFICATION_EXPIRED",
          );
        }
        cardVerificationClaimed = true;
        const verificationCardId = decryptCardToken({
          ciphertext: verifiedCard.billingKeyCiphertext!,
          iv: verifiedCard.billingKeyIv!,
          tag: verifiedCard.billingKeyTag!,
        }, verifiedCard.id);
        const revocationOrderId = createPaymentTrackId("AUDT");
        try {
          const revocation = await revokeThePayOneCard(
            verificationCardId,
            revocationOrderId,
            paymentCredentialScope,
          );
          await db`
            update shorts_mvp.billing_card_verifications
            set status='revoked',consumed_billing_order_id=${order.id},
              consumed_at=clock_timestamp(),revocation_order_id=${revocationOrderId},
              revocation_transaction_id=${revocation.providerTransactionId},
              revocation_result_code=${revocation.resultCode},revoked_at=clock_timestamp(),
              billing_key_ciphertext=null,billing_key_iv=null,
              billing_key_tag=null,billing_key_hash=null
            where id=${verifiedCard.id} and user_id=${session.userId}
              and status='consuming'
          `;
          cardVerificationClaimed = false;
        } catch (error) {
          await db`
            update shorts_mvp.billing_card_verifications
            set status='revoke_failed',revocation_order_id=${revocationOrderId},
              revocation_result_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"}
            where id=${verifiedCard.id} and user_id=${session.userId}
              and status='consuming'
          `.catch(() => undefined);
          throw error;
        }
      }
      if (!isManualPackage) {
        const authTrackId = createPaymentTrackId("AUTH");
        const registrationAmount = billingCycle === "monthly"
          ? plan.monthlyPriceKrw
          : 0;
        const registration = await registerThePayOneCard({
          trackId: authTrackId,
          amount: registrationAmount,
          payerName: body.payerName,
          payerEmail: body.payerEmail,
          payerTel: body.payerTel,
          cardNumber: body.cardNumber,
          expiry: `${body.expiryYear}${body.expiryMonth}`,
          authDob: body.identityNumber,
          authPw: body.cardPassword,
          billingDay,
          productName: orderName,
        }, paymentCredentialScope);
        issuedCardId = registration.cardId;
        registrationTransactionId = registration.providerTransactionId;
        chargeCardId = registration.cardId;
        if (
          registration.trackId !== authTrackId
          || registration.amount !== registrationAmount
          || registration.billingDay !== billingDay
        ) {
          throw new ThePayOneError(
            "카드 등록 결과가 요청 정보와 일치하지 않습니다.",
            "REGISTRATION_MISMATCH",
            null,
            true,
          );
        }
        const encrypted = encryptCardToken(registration.cardId, paymentMethodId!);
        const encryptedPhone = encryptBillingPhone(body.payerTel, paymentMethodId!);
        const masked = `${body.cardNumber.slice(0, 6)}${"*".repeat(Math.max(3, body.cardNumber.length - 10))}${body.cardNumber.slice(-4)}`;
        await db`
          insert into shorts_mvp.billing_payment_methods (
            id,user_id,provider,billing_key_ciphertext,billing_key_iv,billing_key_tag,billing_key_hash,
            registration_order_id,registration_transaction_id,registration_result_code,
            provider_merchant_id,provider_terminal_id,provider_schedule_status,
            payer_tel_ciphertext,payer_tel_iv,payer_tel_tag,
            issuer_name,card_number_masked,card_last4,card_type,status
          ) values (
            ${paymentMethodId},${session.userId},'thepayone',${encrypted.ciphertext},${encrypted.iv},${encrypted.tag},
            ${cardTokenHash(registration.cardId)},${authTrackId},${registration.providerTransactionId},${registration.resultCode},
            ${merchantId},${expectedTerminalId},${billingCycle === "monthly" ? "active" : "none"},
            ${encryptedPhone.ciphertext},${encryptedPhone.iv},${encryptedPhone.tag},
            ${resolveStoredCardIssuer({
              issuer: registration.issuer,
              acquirer: registration.acquirer,
              cardNumberMasked: body.cardNumber,
            })},${masked},${registration.last4},${registration.cardType},'active'
          )
        `;
      }
    }
    if (!isManualPackage) {
      await db`
        update shorts_mvp.billing_orders
        set payment_method_id=${paymentMethodId},provider_card_id_hash=${cardTokenHash(chargeCardId)}
        where id=${order.id} and status='processing'
      `;
    }

    if (!chargeNow) {
      const oldPaused = await pauseOldSchedule(oldMethod);
      if (!oldPaused) {
        await changeThePayOneCardStatus(
          chargeCardId,
          "중지",
          createPaymentTrackId("AUDT"),
          paymentCredentialScope,
        ).catch(() => undefined);
        await db`
          update shorts_mvp.billing_payment_methods
          set status='manual_review',provider_schedule_status='manual_review'
          where id=${paymentMethodId}
        `;
        throw new ThePayOneError("기존 자동결제 중지 여부를 확인하지 못했습니다.", "OLD_SCHEDULE_PAUSE_FAILED", null, true);
      }
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.user_subscriptions
          set payment_method_id=${paymentMethodId},payment_provider='thepayone',
            provider_schedule_status=${billingCycle === "monthly" ? "active" : "none"},
            billing_review_status='clear',billing_review_reason=null
          where id=${current!.id} and user_id=${session.userId} and status='active'
        `;
        if (oldMethod) await tx`
          update shorts_mvp.billing_payment_methods
          set status='replaced',provider_schedule_status=${oldMethod.provider === "thepayone" ? "paused" : oldMethod.providerScheduleStatus},
            payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null,revoked_at=now()
          where id=${oldMethod.id}
        `;
        await tx`
          update shorts_mvp.billing_orders
          set status='succeeded',provider_transaction_id=${registrationTransactionId},
            provider_status='card_registered',approved_at=now()
          where id=${order.id}
        `;
        await setDefaultPaymentMethod(
          tx,
          session.userId,
          paymentMethodId!,
        );
      });
      return NextResponse.json({ ok: true, orderId: order.orderId, paymentMethodUpdated: true });
    }

    const attempts = await db`
      insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
      values (${order.id},1,${order.orderId})
      on conflict (order_id,attempt_no) do nothing returning id
    `;
    billingAttemptId = attempts[0]?.id || null;
    if (!billingAttemptId) throw new HttpError(409, "같은 결제가 이미 처리 중입니다.");
    const paymentDescription = pricingV2Plan?.kind === "package"
      ? `${plan.prepaidMonths}개월 패키지 단건 결제`
      : billingCycle === "yearly" ? "연간 이용권 선결제" : "월간 구독 첫 결제";
    const payment = isManualPackage
      ? await chargeThePayOneManualCard({
        trackId: order.orderId,
        cardNumber: manualPackageCard!.cardNumber,
        expiry: manualPackageCard!.expiry,
        authDob: manualPackageCard!.authDob,
        authPw: manualPackageCard!.authPw,
        amount: chargeAmount,
        payerName: manualPackageCard!.payerName,
        payerEmail: manualPackageCard!.payerEmail,
        payerTel: manualPackageCard!.payerTel,
        installmentMonths: requestedInstallmentMonths,
        productName: orderName,
        description: paymentDescription,
        referenceId: order.id,
      }, "manual")
      : await chargeThePayOneCard({
        trackId: order.orderId,
        cardId: chargeCardId,
        authDob: body.identityNumber,
        authPw: body.cardPassword,
        amount: chargeAmount,
        payerName,
        payerEmail,
        payerTel,
        billingDay,
        installmentMonths: requestedInstallmentMonths,
        productName: orderName,
        description: paymentDescription,
        referenceId: order.id,
      }, paymentCredentialScope);
    providerPaymentCompleted = true;
    const installmentCardTypeRejected = (
      isManualPackage
      && !thePayOneCardTypeAllowsInstallment(
        payment.cardType,
        requestedInstallmentMonths,
      )
    );
    const paymentMismatchFields = [
      payment.trackId !== order.orderId ? "trackId" : null,
      payment.amount !== chargeAmount ? "amount" : null,
      (!isManualPackage && payment.cardId !== chargeCardId) ? "cardId" : null,
      payment.terminalId !== expectedTerminalId ? "terminalId" : null,
      (
        isManualPackage
        && !installmentResponseMatchesSelection({
          requestedMonths: requestedInstallmentMonths,
          responseMonths: payment.installmentMonths,
          requestedIssuer: requestedInstallmentIssuer,
          responseIssuer: payment.issuer,
          responseAcquirer: payment.acquirer,
        })
      ) ? "installmentSelection" : null,
      (
        !isManualPackage
        && payment.installmentMonths !== requestedInstallmentMonths
      ) ? "installmentMonths" : null,
      installmentCardTypeRejected ? "cardType" : null,
    ].filter((field): field is string => Boolean(field));
    const installmentTermsSnapshot = isManualPackage
      ? {
        ...installment.snapshot,
        declaredCardKind,
        providerResponseIssuer: payment.issuer,
        providerResponseAcquirer: payment.acquirer,
        providerResponseCardType: payment.cardType,
        providerResponseCardKindMatchesSelection: declaredCardKind
          ? thePayOneCardTypeMatchesDeclaredKind(payment.cardType, declaredCardKind)
          : null,
        providerResponseInstallmentMonths: payment.installmentMonths,
      }
      : installment.snapshot;
    if (paymentMismatchFields.length) {
      if (isManualPackage) {
        await db`
          update shorts_mvp.billing_orders
          set provider_transaction_id=${payment.providerTransactionId},
            provider_auth_code=${payment.authCode},
            provider_terminal_id=${payment.terminalId},
            provider_transaction_day=${kstTransactionDay(payment.approvedAt)},
            installment_terms_snapshot=${db.json(installmentTermsSnapshot as never)}
          where id=${order.id} and status='processing'
        `;
      }
      throw new ThePayOneError(
        installmentCardTypeRejected
          ? "입력한 카드가 체크·선불카드로 확인되어 할부 결제를 확정할 수 없습니다."
          : "결제 승인 결과가 주문 정보와 일치하지 않습니다.",
        installmentCardTypeRejected
          ? "INSTALLMENT_CARD_TYPE_NOT_CREDIT"
          : "PAYMENT_MISMATCH",
        `불일치: ${paymentMismatchFields.join(",")}`,
        true,
      );
    }
    let replacementRefundTransactionId: string | null = null;
    if (needsCurrentPaymentFullRefund && currentPaymentToRefund) {
      const refundAmount = Number(currentPaymentToRefund.amountKrw);
      const refundTrackId = createPaymentTrackId("REFUND");
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.billing_orders
          set provider_transaction_id=${payment.providerTransactionId},
            provider_auth_code=${payment.authCode},
            provider_transaction_day=${kstTransactionDay(payment.approvedAt)},
            installment_months=${payment.installmentMonths}
          where id=${order.id} and status='processing'
        `;
        const claimedRefund = await tx`
          update shorts_mvp.billing_orders
          set proration_credit_krw=${refundAmount},
            proration_refund_track_id=${refundTrackId},proration_refund_status='pending'
          where id=${currentPaymentToRefund.id} and status='succeeded'
            and refunded_amount_krw=0 and refund_status='none'
            and proration_refund_status='none'
          returning id
        `;
        if (!claimedRefund[0]) {
          throw new HttpError(
            409,
            "기존 월간 결제의 전액취소가 이미 처리 중입니다.",
            "CURRENT_PAYMENT_REFUND_ALREADY_PROCESSING",
          );
        }
      });
      try {
        const refund = await refundThePayOnePayment({
          trackId: refundTrackId,
          rootTransactionId: currentPaymentToRefund.providerTransactionId,
          amount: refundAmount,
          referenceId: currentPaymentToRefund.id,
          reason: replacesEasycutPro
            ? "이지컷 프로 패키지 전환 기존 결제 전액취소"
            : "월간 플랜 업그레이드 기존 결제 전액취소",
        });
        const refundMismatchFields = thePayOneRefundMismatchFields(refund, {
          trackId: refundTrackId,
          rootTransactionId: currentPaymentToRefund.providerTransactionId,
          amount: refundAmount,
          terminalId: currentPaymentToRefund.providerTerminalId,
        });
        if (refundMismatchFields.length > 0) {
          throw new ThePayOneError(
            "기존 월간 결제의 전액취소 결과가 주문 정보와 일치하지 않습니다.",
            "CURRENT_PAYMENT_REFUND_MISMATCH",
            `불일치 필드: ${refundMismatchFields.join(",")}`,
            true,
          );
        }
        replacementRefundTransactionId = refund.providerTransactionId;
        await db`
          update shorts_mvp.billing_orders
          set refunded_amount_krw=${refundAmount},refund_status='full',
            proration_refund_transaction_id=${refund.providerTransactionId},
            proration_refund_status='succeeded'
          where id=${currentPaymentToRefund.id} and status='succeeded'
            and proration_refund_status='pending'
        `;
      } catch (error) {
        let packageChargeReversed = false;
        if (replacesEasycutPro) {
          const reversalTrackId = createPaymentTrackId("REFUND");
          try {
            const reversal = await refundThePayOnePayment({
              trackId: reversalTrackId,
              rootTransactionId: payment.providerTransactionId,
              amount: chargeAmount,
              referenceId: order.id,
              reason: "기존 프로 환불 실패로 패키지 결제 전액취소",
            }, paymentCredentialScope);
            const reversalMismatchFields = thePayOneRefundMismatchFields(reversal, {
              trackId: reversalTrackId,
              rootTransactionId: payment.providerTransactionId,
              amount: chargeAmount,
              terminalId: expectedTerminalId,
            });
            if (reversalMismatchFields.length > 0) {
              throw new ThePayOneError(
                "패키지 결제 취소 결과가 주문 정보와 일치하지 않습니다.",
                "PACKAGE_REVERSAL_MISMATCH",
                `불일치 필드: ${reversalMismatchFields.join(",")}`,
                true,
              );
            }
            await db`
              update shorts_mvp.billing_orders
              set refunded_amount_krw=${chargeAmount},refund_status='full',
                proration_refund_track_id=${reversalTrackId},
                proration_refund_transaction_id=${reversal.providerTransactionId},
                proration_refund_status='succeeded'
              where id=${order.id} and status='processing'
            `;
            packageChargeReversed = true;
            providerPaymentCompleted = false;
          } catch {
            // The original payment remains under manual review if compensation
            // cannot be proved successful.
          }
        }
        if (chargeCardId) {
          await changeThePayOneCardStatus(
            chargeCardId,
            "중지",
            createPaymentTrackId("AUDT"),
            paymentCredentialScope,
          ).catch(() => undefined);
        }
        await db`
          update shorts_mvp.billing_orders
          set proration_refund_status='manual_review',refund_status='manual_review'
          where id=${currentPaymentToRefund.id} and proration_refund_status='pending'
        `.catch(() => undefined);
        if (paymentMethodId) {
          await db`
            update shorts_mvp.billing_payment_methods
            set status='manual_review',provider_schedule_status='manual_review'
            where id=${paymentMethodId}
          `.catch(() => undefined);
        }
        if (packageChargeReversed) {
          throw new HttpError(
            502,
            "기존 이지컷 프로 결제를 환불하지 못해 패키지 결제를 전액 취소했습니다. 기존 프로 이용권은 그대로 유지됩니다.",
            "PRO_REFUND_FAILED_PACKAGE_REVERSED",
          );
        }
        throw error;
      }
    }

    let oldPaused = true;
    let scheduleReview = false;
    let reusedMethodScheduleStatus = oldMethod?.providerScheduleStatus || "none";
    if (reuseStoredMethod) {
      if (billingCycle === "monthly" && oldMethod?.providerScheduleStatus !== "active") {
        const resumed = await changeThePayOneCardStatus(
          chargeCardId,
          "사용",
          createPaymentTrackId("AUDT"),
          paymentCredentialScope,
        ).then(() => true).catch(() => false);
        scheduleReview = !resumed;
        reusedMethodScheduleStatus = resumed ? "active" : "manual_review";
      } else if (billingCycle === "yearly" && oldMethod?.providerScheduleStatus === "active") {
        const paused = await changeThePayOneCardStatus(
          chargeCardId,
          "중지",
          createPaymentTrackId("AUDT"),
          paymentCredentialScope,
        ).then(() => true).catch(() => false);
        scheduleReview = !paused;
        reusedMethodScheduleStatus = paused ? "paused" : "manual_review";
      }
    } else {
      oldPaused = await pauseOldSchedule(oldMethod);
      scheduleReview = !oldPaused;
      if (!oldPaused && billingCycle === "monthly") {
        const newPaused = await changeThePayOneCardStatus(
          chargeCardId,
          "중지",
          createPaymentTrackId("AUDT"),
          paymentCredentialScope,
        ).then(() => true).catch(() => false);
        scheduleReview = true;
        if (newPaused) {
          await db`
            update shorts_mvp.billing_payment_methods set provider_schedule_status='paused'
            where id=${paymentMethodId}
          `;
        }
      }
    }

    const approvedAt = payment.approvedAt;
    const monthlyPeriodReset = Boolean(changeQuote?.startsNewBillingPeriod);
    const immediateProration = changeQuote?.action === "immediate_proration" && !monthlyPeriodReset;
    const immediateAnnualConversion = changeQuote?.action === "immediate_annual_conversion";
    const periodStart = monthlyPeriodReset
      ? approvedAt
      : immediateProration
      ? current!.currentPeriodStart
      : immediateAnnualConversion
        ? approvedAt
        : current?.currentPeriodEnd && current.currentPeriodEnd > approvedAt
          ? current.currentPeriodEnd
          : approvedAt;
    const periodEnd = monthlyPeriodReset
      ? addKstMonths(
        periodStart,
        billingCycle === "yearly" ? plan.prepaidMonths : 1,
        Number(billingDay) || undefined,
      )
      : immediateProration
      ? current!.currentPeriodEnd
      : billingCycle === "yearly"
        ? addKstMonths(periodStart, plan.prepaidMonths)
        : addKstMonths(periodStart, 1, Number(billingDay));
    let subscriptionId = current?.id || "";
    await db.begin(async (tx) => {
      if (!current) {
        const locked = await tx`
          select id,plan_code,billing_cycle from shorts_mvp.user_subscriptions
          where user_id=${session.userId} and status in ('pending','trialing','active','past_due') for update
        `;
        if (
          locked[0]
          && (
            !stackingPackage
            || locked.some((item) => (
              item.billingCycle === "monthly"
              || !isPricingV2PackageCode(item.planCode)
            ))
          )
        ) {
          throw new HttpError(409, "현재 이용권 상태에서는 패키지를 추가 구매할 수 없습니다.");
        }
        const subscriptions = await tx`
          insert into shorts_mvp.user_subscriptions (
            user_id,plan_code,status,billing_cycle,payment_method_id,payment_provider,
            provider_schedule_status,billing_review_status,billing_review_reason,
            current_period_start,current_period_end,next_charge_at,next_quota_at,billing_anchor_day
          ) values (
            ${session.userId},${plan.code},'active',${billingCycle},${paymentMethodId},'thepayone',
            ${scheduleReview ? "manual_review" : billingCycle === "monthly" ? "active" : "none"},
            ${scheduleReview ? "manual_review" : "clear"},${scheduleReview ? "OLD_SCHEDULE_PAUSE_FAILED" : null},
            ${approvedAt},${periodEnd},${pricingV2Plan?.kind === "package" ? null : periodEnd},
            ${addKstMonths(approvedAt, 1)},${Number(billingDay) || Math.min(new Date(approvedAt.getTime()+9*60*60*1000).getUTCDate(),28)}
          ) returning id
        `;
        subscriptionId = subscriptions[0].id;
        const quotaEnd = await createBaseUsageGrant({
          db: tx,
          userId: session.userId,
          subscriptionId,
          billingOrderId: order.id,
          plan,
          validFrom: approvedAt,
          subscriptionEnd: periodEnd,
          carryUntilSubscriptionEnd: isPricingV2PackageCode(plan.code),
        });
        await tx`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${subscriptionId}`;
      } else {
        const stillActive = current.currentPeriodEnd > approvedAt && current.status === "active";
        const resetsUpgradeQuota = stillActive && Boolean(changeQuote);
        await tx`
          update shorts_mvp.user_subscriptions
          set plan_code=${plan.code},billing_cycle=${billingCycle},status='active',
            payment_method_id=${paymentMethodId},payment_provider='thepayone',
            provider_schedule_status=${scheduleReview ? "manual_review" : billingCycle === "monthly" ? "active" : "none"},
            billing_review_status=${scheduleReview ? "manual_review" : "clear"},
            billing_review_reason=${scheduleReview ? "OLD_SCHEDULE_PAUSE_FAILED" : null},
            current_period_start=${immediateProration ? current.currentPeriodStart : periodStart},
            current_period_end=${periodEnd},
            next_charge_at=${isManualPackage ? null : periodEnd},next_retry_at=null,
            grace_ends_at=null,retry_count=0,cancel_at_period_end=false,canceled_at=null,
            scheduled_plan_code=null,scheduled_billing_cycle=null,
            billing_anchor_day=${monthlyPeriodReset
              ? Number(billingDay)
              : changeQuote
              ? current.billingAnchorDay || Math.min(new Date(periodStart.getTime()+9*60*60*1000).getUTCDate(),28)
              : Number(billingDay) || Math.min(new Date(periodStart.getTime()+9*60*60*1000).getUTCDate(),28)}
          where id=${current.id} and user_id=${session.userId} and status in ('active','past_due')
        `;
        if (resetsUpgradeQuota) {
          const currentBaseGrants = await tx`
            select id,total_seconds,consumed_seconds,reserved_seconds
            from shorts_mvp.usage_grants
            where subscription_id=${current.id} and kind='base' and status='active'
              and valid_from <= ${approvedAt} and expires_at > ${approvedAt}
            for update
          `;
          const typedBaseGrants = currentBaseGrants as unknown as Array<{
            id: string;
            totalSeconds: number;
            consumedSeconds: number;
            reservedSeconds: number;
          }>;
          const carriedBaseSeconds = typedBaseGrants.reduce(
            (total, grant) => total + Math.max(
              0,
              Number(grant.totalSeconds) - Number(grant.consumedSeconds),
            ),
            0,
          );
          const reservedBaseSeconds = typedBaseGrants.reduce(
            (total, grant) => total + Number(grant.reservedSeconds || 0),
            0,
          );
          const upgradedBaseGrantSeconds = monthlyUpgradeBaseGrantSeconds({
            targetPlanSeconds: plan.monthlySourceSeconds,
            currentBaseUnconsumedSeconds: replacesEasycutPro ? 0 : carriedBaseSeconds,
          });
          await tx`
            update shorts_mvp.usage_grants set status='revoked'
            where subscription_id=${current.id} and kind='base' and status='active'
              and valid_from <= ${approvedAt} and expires_at > ${approvedAt}
          `;
          const quotaEnd = await createBaseUsageGrant({
            db: tx,
            userId: session.userId,
            subscriptionId: current.id,
            billingOrderId: order.id,
            plan,
            validFrom: approvedAt,
            subscriptionEnd: periodEnd,
            billingAnchorDay: Math.min(
              new Date(approvedAt.getTime() + 9 * 60 * 60 * 1000).getUTCDate(),
              28,
            ),
            totalSeconds: upgradedBaseGrantSeconds,
            creditedSeconds: plan.monthlySourceSeconds,
            carriedSeconds: carriedBaseSeconds,
            carryUntilSubscriptionEnd: isPricingV2PackageCode(plan.code),
          });
          if (typedBaseGrants.length > 0 && reservedBaseSeconds > 0 && upgradedBaseGrantSeconds > 0) {
            const upgradedBaseGrants = await tx`
              select id from shorts_mvp.usage_grants
              where subscription_id=${current.id} and kind='base' and status='active'
                and valid_from=${approvedAt}
              for update
            `;
            const upgradedBaseGrant = upgradedBaseGrants[0] as { id: string } | undefined;
            if (!upgradedBaseGrant) {
              throw new HttpError(409, "업그레이드 사용량을 생성하지 못했습니다. 고객센터로 문의해 주세요.");
            }
            await tx`
              update shorts_mvp.usage_grants
              set reserved_seconds=${reservedBaseSeconds}
              where id=${upgradedBaseGrant.id}
            `;
            await tx`
              insert into shorts_mvp.usage_grant_allocations (
                reservation_id,grant_id,allocated_seconds,status
              )
              select reservation_id,${upgradedBaseGrant.id},sum(allocated_seconds)::integer,'reserved'
              from shorts_mvp.usage_grant_allocations
              where grant_id in ${tx(typedBaseGrants.map((grant) => grant.id))}
                and status='reserved'
              group by reservation_id
              on conflict (reservation_id,grant_id) do update
              set allocated_seconds=excluded.allocated_seconds,status='reserved'
            `;
            await tx`
              delete from shorts_mvp.usage_grant_allocations
              where grant_id in ${tx(typedBaseGrants.map((grant) => grant.id))}
                and status='reserved'
            `;
            await tx`
              update shorts_mvp.usage_grants
              set reserved_seconds=0
              where id in ${tx(typedBaseGrants.map((grant) => grant.id))}
            `;
          }
          await tx`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${current.id}`;
        } else if (!stillActive) {
          const quotaEnd = await createBaseUsageGrant({
            db: tx,
            userId: session.userId,
            subscriptionId: current.id,
            billingOrderId: order.id,
            plan,
            validFrom: periodStart,
            subscriptionEnd: periodEnd,
            carryUntilSubscriptionEnd: isPricingV2PackageCode(plan.code),
          });
          await tx`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${current.id}`;
        }
      }
      await tx`
        update shorts_mvp.billing_orders
        set subscription_id=${subscriptionId},status='succeeded',
          provider_transaction_id=${payment.providerTransactionId},provider_status='paid',
          provider_terminal_id=${payment.terminalId},provider_auth_code=${payment.authCode},
          provider_card_id_hash=${isManualPackage ? null : cardTokenHash(payment.cardId)},
          provider_transaction_day=${kstTransactionDay(approvedAt)},
          installment_months=${payment.installmentMonths},
          installment_terms_snapshot=${tx.json(installmentTermsSnapshot as never)},
          approved_at=${approvedAt},failure_code=null,failure_message=null
        where id=${order.id}
      `;
      if (
        changeQuote?.refundMode === "manual_partial"
        && changeQuote.refundAmountKrw > 0
        && currentPaymentToRefund
        && current
      ) {
        const refundStatus = currentPaymentToRefund.providerAuthCode
          ? "pending"
          : "manual_review";
        await tx`
          insert into shorts_mvp.subscription_upgrade_refunds (
            upgrade_order_id,source_order_id,user_id,source_plan_code,target_plan_code,
            target_billing_cycle,source_provider_transaction_id,source_transaction_day,
            source_approved_at,source_auth_code,source_amount_krw,refund_amount_krw,
            period_start,period_end,total_period_days,unused_period_days,
            card_issuer,card_last4,status,admin_note
          ) values (
            ${order.id},${currentPaymentToRefund.id},${session.userId},${current.planCode},${plan.code},
            ${billingCycle},${currentPaymentToRefund.providerTransactionId},
            ${currentPaymentToRefund.providerTransactionDay || kstTransactionDay(currentPaymentToRefund.approvedAt)},
            ${currentPaymentToRefund.approvedAt},${currentPaymentToRefund.providerAuthCode},
            ${Number(currentPaymentToRefund.amountKrw)},${changeQuote.refundAmountKrw},
            ${current.currentPeriodStart},${current.currentPeriodEnd},
            ${changeQuote.refundTotalPeriodDays},${changeQuote.refundUnusedPeriodDays},
            ${oldMethod?.issuerName || null},${oldMethod?.cardLast4 || null},${refundStatus},
            ${refundStatus === "manual_review" ? "과거 승인번호가 없어 확인이 필요합니다." : ""}
          )
          on conflict (upgrade_order_id) do nothing
        `;
        await tx`
          update shorts_mvp.billing_orders
          set proration_credit_krw=${changeQuote.refundAmountKrw},
            proration_refund_status=${refundStatus}
          where id=${currentPaymentToRefund.id}
            and refunded_amount_krw=0 and refund_status='none'
        `;
      }
      if (replacementRefundTransactionId && currentPaymentToRefund) await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${currentPaymentToRefund.id},subscription_id=${subscriptionId},
          payment_method_id=${current!.paymentMethodId},
          validation_status='processed',processing_result='subscription_replacement_refund_reconciled',
          processed_at=now()
        where provider='thepayone' and provider_transaction_id=${replacementRefundTransactionId}
          and validation_status in ('received','validated')
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',provider_transaction_id=${payment.providerTransactionId},finished_at=now()
        where id=${billingAttemptId}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},subscription_id=${subscriptionId},payment_method_id=${paymentMethodId},
          validation_status='processed',processing_result='server_payment_reconciled',processed_at=now()
        where provider='thepayone' and provider_transaction_id=${payment.providerTransactionId}
          and validation_status in ('received','validated')
      `;
      if (reuseStoredMethod && oldMethod) await tx`
        update shorts_mvp.billing_payment_methods
        set status=${scheduleReview ? "manual_review" : "active"},
          provider_schedule_status=${scheduleReview ? "manual_review" : reusedMethodScheduleStatus}
        where id=${oldMethod.id} and user_id=${session.userId}
      `;
      if (!reuseStoredMethod && oldMethod) await tx`
        update shorts_mvp.billing_payment_methods
        set status=${oldPaused ? "replaced" : "manual_review"},
          provider_schedule_status=${oldPaused ? "paused" : "manual_review"},
          payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null,revoked_at=now()
        where id=${oldMethod.id}
      `;
      if (paymentCredentialScope === "default" && paymentMethodId) {
        await setDefaultPaymentMethod(
          tx,
          session.userId,
          paymentMethodId,
        );
      }
      await syncCachedPlan(tx, session.userId, plan.code);
    });
    return NextResponse.json({
      ok: true,
      checkoutId: order.id,
      orderId: order.orderId,
      subscriptionId,
      planCode: plan.code,
      billingCycle,
      chargedAmountKrw: finalChargeAmount,
      prorationCreditKrw,
      refund: {
        mode: changeQuote?.refundMode || "none",
        amountKrw: changeQuote?.refundAmountKrw || 0,
        processingBusinessDays: changeQuote?.refundMode === "manual_partial" ? 3 : 0,
      },
      installmentMonths: Number(order.installmentMonths || 0),
      nextChargeAt: isManualPackage ? null : periodEnd.toISOString(),
      manualReview: scheduleReview,
    });
  } catch (error) {
    const unknown = providerPaymentCompleted || (error instanceof ThePayOneError && error.outcomeUnknown);
    const failureMessage = safeFailureMessage(error);
    if (billingOrderId && claimedOrder) {
      try {
        const code = error instanceof ThePayOneError
          ? error.resultCode
          : error instanceof HttpError ? error.code : "ACTIVATION_FAILED";
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
          if (paymentMethodId && unknown) await tx`
            update shorts_mvp.billing_payment_methods
            set status='manual_review',provider_schedule_status='manual_review'
            where id=${paymentMethodId}
          `;
        });
      } catch {
        // Preserve the original provider outcome for later reconciliation.
      }
    }
    if (error instanceof ThePayOneError) {
      console.error("thepayone_subscription_activation_failed", {
        billingOrderId,
        resultCode: error.resultCode,
        outcomeUnknown: error.outcomeUnknown,
        diagnostic: error.diagnostic,
      });
    }
    if (
      issuedCardId
      && paymentMethodId
      && (!unknown || paymentCredentialScope === "manual")
    ) {
      try {
        await revokeThePayOneCard(
          issuedCardId,
          createPaymentTrackId("AUDT"),
          paymentCredentialScope,
        );
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.billing_payment_methods
            set status='revoked',provider_schedule_status='disposed',
              payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null,revoked_at=now()
            where id=${paymentMethodId}
          `;
          if (cardVerificationClaimed && cardVerification) await tx`
            update shorts_mvp.billing_card_verifications
            set status='revoked',revoked_at=clock_timestamp(),
              billing_key_ciphertext=null,billing_key_iv=null,
              billing_key_tag=null,billing_key_hash=null
            where id=${cardVerification.id}
          `;
        });
      } catch {
        // A failed cleanup is intentionally not retried with sensitive card authentication data.
      }
    } else if (cardVerificationClaimed && cardVerification && !issuedCardId) {
      await getDb()`
        update shorts_mvp.billing_card_verifications
        set status='revoke_failed'
        where id=${cardVerification.id} and status='consuming'
      `.catch(() => undefined);
    }
    if (unknown && billingOrderId) {
      return NextResponse.json({
        ok: false,
        checkoutId: billingOrderId,
        manualReview: true,
      }, { status: 202 });
    }
    const providerInstallmentMaxMonths = error instanceof ThePayOneError
      ? thePayOneInstallmentMaxMonths(error.diagnostic)
      : null;
    if (providerInstallmentMaxMonths !== null) {
      return NextResponse.json({
        detail: `해당 카드는 최대 ${providerInstallmentMaxMonths}개월 할부까지 지원합니다. 할부 개월수를 다시 선택해 주세요.`,
        code: "INSTALLMENT_LIMIT_EXCEEDED",
        maxInstallmentMonths: providerInstallmentMaxMonths,
      }, { status: 400 });
    }
    if (error instanceof ThePayOneError && failureMessage) {
      return apiError(
        new HttpError(400, failureMessage, "THEPAYONE_REJECTED"),
        "더페이원 구독 결제를 완료하지 못했습니다.",
      );
    }
    return apiError(error, "더페이원 구독 결제를 완료하지 못했습니다.");
  }
}
