"use client";

import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import { PurchaseTermsConsent } from "@/components/purchase-terms-consent";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import {
  billingPostJson,
  purchasePlanWithSavedCard,
} from "@/lib/billing-client";
import type { PricingV2PlanProduct } from "@/lib/pricing-v2";
import { useEffect, useRef, useState } from "react";

type CheckoutMode = "subscribe" | "change_subscription";

type CheckoutForm = {
  cardNumberParts: string[];
  expiryMonth: string;
  expiryYear: string;
  cardPassword: string;
  identityNumber: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  consent: boolean;
};

type ActivationResult = {
  checkoutId?: string;
};

type CardVerification = {
  id: string;
  issuer: string | null;
  cardType: string | null;
  last4: string | null;
  expiresAt: string;
};

type ChangeQuote = {
  chargeAmountKrw: number;
};

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

export function PlanCheckoutOverlay({
  mode,
  product,
  initialName,
  initialEmail,
  savedPaymentMethod,
  onClose,
}: {
  mode: CheckoutMode;
  product: PricingV2PlanProduct;
  initialName?: string | null;
  initialEmail?: string | null;
  savedPaymentMethod?: {
    hasStoredPayerTel: boolean;
  } | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"card" | "payer">("card");
  const cardPartRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [form, setForm] = useState<CheckoutForm>({
    cardNumberParts: ["", "", "", ""],
    expiryMonth: "",
    expiryYear: "",
    cardPassword: "",
    identityNumber: "",
    payerName: initialName?.trim() || initialEmail?.split("@", 1)[0] || "Easy Cut 고객",
    payerEmail: initialEmail || "",
    payerTel: "",
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("결제를 확인해 주세요");
  const [changeQuote, setChangeQuote] = useState<ChangeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(mode === "change_subscription");
  const [cardVerification, setCardVerification] = useState<CardVerification | null>(null);
  const cardVerificationIdRef = useRef<string | null>(null);
  const operationInFlightRef = useRef(false);
  const usesSavedPaymentMethod = Boolean(savedPaymentMethod);

  const chargeAmount = mode === "change_subscription"
    ? changeQuote?.chargeAmountKrw ?? null
    : product.totalPriceKrw;
  const cardNumber = form.cardNumberParts.join("");
  const cardStepValid = (
    cardNumber.length === 16
    && /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
    && digits(form.cardPassword, 2).length === 2
    && [6, 10].includes(digits(form.identityNumber, 10).length)
    && /^\d{10,11}$/.test(digits(form.payerTel, 11))
    && form.consent
  );
  const payerStepValid = Boolean(
    cardVerification
    && new Date(cardVerification.expiresAt) > new Date()
    && chargeAmount !== null
    && !quoteLoading
    && Boolean(form.payerName.trim())
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.payerEmail.trim()),
  );
  const savedCardValid = Boolean(
    chargeAmount !== null
    && !quoteLoading
    && [6, 10].includes(digits(form.identityNumber, 10).length)
    && digits(form.cardPassword, 2).length === 2
    && (savedPaymentMethod?.hasStoredPayerTel || /^\d{10,11}$/.test(digits(form.payerTel, 11)))
    && form.consent
  );

  useEffect(() => () => {
    const verificationId = cardVerificationIdRef.current;
    if (!verificationId) return;
    cardVerificationIdRef.current = null;
    void fetch(`/api/billing/card-verifications/${verificationId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  }, []);

  useEffect(() => {
    if (mode !== "change_subscription") {
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      planCode: product.code,
      billingCycle: product.billingCycle,
    });
    fetch(`/api/billing/subscription/change?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as ChangeQuote & { detail?: string };
        if (!response.ok) throw new Error(value.detail || "결제금액을 불러오지 못했습니다.");
        setChangeQuote(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "결제금액을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [mode, product.billingCycle, product.code]);

  function update<Key extends keyof CheckoutForm>(key: Key, value: CheckoutForm[Key]) {
    const verificationId = key === "payerName" || key === "payerEmail"
      ? null
      : cardVerificationIdRef.current;
    if (verificationId) {
      cardVerificationIdRef.current = null;
      setCardVerification(null);
      void billingPostJson(
        `/api/billing/card-verifications/${verificationId}/revoke`,
        {},
      ).catch(() => undefined);
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateCardNumberPart(index: number, rawValue: string) {
    const value = digits(rawValue, 16);
    const nextParts = [...form.cardNumberParts];
    if (value.length <= 4) {
      nextParts[index] = value;
      update("cardNumberParts", nextParts);
      if (value.length === 4 && index < 3) {
        window.requestAnimationFrame(() => cardPartRefs.current[index + 1]?.focus());
      }
      return;
    }
    let cursor = 0;
    for (let partIndex = index; partIndex < 4; partIndex += 1) {
      nextParts[partIndex] = value.slice(cursor, cursor + 4);
      cursor += 4;
    }
    update("cardNumberParts", nextParts);
    const destination = Math.min(3, index + Math.ceil(value.length / 4) - 1);
    window.requestAnimationFrame(() => cardPartRefs.current[destination]?.focus());
  }

  function pasteCardNumber(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const value = digits(event.clipboardData.getData("text"), 16);
    if (value.length <= 4) return;
    event.preventDefault();
    updateCardNumberPart(index, value);
  }

  async function verifyCard() {
    if (!cardStepValid || busy || operationInFlightRef.current) return;
    if (
      cardVerification
      && new Date(cardVerification.expiresAt) > new Date()
    ) {
      setStep("payer");
      return;
    }
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("카드 정보를 확인해 주세요");
    try {
      const result = await billingPostJson<{ verification: CardVerification }>(
        "/api/billing/card-verifications",
        {
          requestId: crypto.randomUUID(),
          mode,
          planCode: product.code,
          billingCycle: product.billingCycle,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber,
          expiryYear: form.expiryYear,
          expiryMonth: form.expiryMonth,
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
          consent: true,
        },
      );
      cardVerificationIdRef.current = result.verification.id;
      setCardVerification(result.verification);
      setStep("payer");
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "카드 정보를 확인하지 못했습니다. 입력값을 다시 확인해 주세요.");
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function completePayment() {
    if (
      !payerStepValid
      || busy
      || operationInFlightRef.current
      || !cardVerification
    ) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("결제를 확인해 주세요");
    try {
      const result = await billingPostJson<ActivationResult>("/api/billing/activate", {
        mode,
        requestId: crypto.randomUUID(),
        planCode: product.code,
        billingCycle: product.billingCycle,
        payerName: form.payerName.trim(),
        payerEmail: form.payerEmail.trim(),
        payerTel: digits(form.payerTel, 11),
        cardNumber,
        expiryYear: form.expiryYear,
        expiryMonth: form.expiryMonth,
        cardVerificationId: cardVerification.id,
        identityNumber: digits(form.identityNumber, 10),
        cardPassword: digits(form.cardPassword, 2),
        consent: true,
        installmentMonths: 0,
        installmentCampaignId: null,
      });
      cardVerificationIdRef.current = null;
      const success = new URL("/billing/success", window.location.origin);
      success.searchParams.set("flow", "subscription");
      success.searchParams.set("status", "activated");
      success.searchParams.set("source", "pricing");
      if (result.checkoutId) success.searchParams.set("checkoutId", result.checkoutId);
      window.location.assign(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결제를 완료하지 못했습니다.");
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function completeSavedPayment() {
    if (
      !usesSavedPaymentMethod
      || !savedCardValid
      || chargeAmount === null
      || busy
      || operationInFlightRef.current
    ) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("결제를 확인해 주세요");
    try {
      const result = await purchasePlanWithSavedCard({
        mode,
        planCode: product.code,
        billingCycle: product.billingCycle,
        expectedChargeAmountKrw: chargeAmount,
        identityNumber: digits(form.identityNumber, 10),
        cardPassword: digits(form.cardPassword, 2),
        ...(savedPaymentMethod?.hasStoredPayerTel
          ? {}
          : { payerTel: digits(form.payerTel, 11) }),
      });
      const success = new URL("/billing/success", window.location.origin);
      success.searchParams.set("flow", "subscription");
      success.searchParams.set("status", "activated");
      success.searchParams.set("source", "pricing");
      if (result.checkoutId) success.searchParams.set("checkoutId", result.checkoutId);
      window.location.assign(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결제를 완료하지 못했습니다.");
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <ThePayOnePaymentOverlay
        title={usesSavedPaymentMethod || step === "card" ? "카드 정보" : "결제자 정보"}
        busy={busy}
        primaryDisabled={usesSavedPaymentMethod
          ? !savedCardValid
          : step === "card"
            ? !cardStepValid
            : !payerStepValid}
        primaryLabel={busy
          ? usesSavedPaymentMethod || step === "payer"
            ? "결제를 진행하고 있습니다..."
            : "카드를 확인하고 있습니다..."
          : usesSavedPaymentMethod
            ? quoteLoading || chargeAmount === null ? "결제정보 확인 중..." : "확인"
            : step === "card"
              ? "다음"
              : chargeAmount === null ? "결제정보 확인 중..." : "확인"}
        secondaryLabel={usesSavedPaymentMethod ? "취소" : step === "payer" ? "이전" : undefined}
        onClose={onClose}
        onSecondary={usesSavedPaymentMethod ? onClose : () => setStep("card")}
        onSubmit={() => {
          if (usesSavedPaymentMethod) {
            void completeSavedPayment();
          } else if (step === "card") {
            void verifyCard();
          } else {
            void completePayment();
          }
        }}
      >
        {usesSavedPaymentMethod ? (
          <div className="mt-8 grid gap-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  data-payment-autofocus
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.identityNumber}
                  onChange={(event) => update("identityNumber", digits(event.target.value, 10))}
                  placeholder="6자리 또는 10자리"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                카드 비밀번호 앞 2자리
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.cardPassword}
                  onChange={(event) => update("cardPassword", digits(event.target.value, 2))}
                  placeholder="••"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            {!savedPaymentMethod?.hasStoredPayerTel && (
              <label className="text-xs font-bold text-neutral-300">
                휴대전화 번호
                <input
                  required
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.payerTel}
                  onChange={(event) => update("payerTel", digits(event.target.value, 11))}
                  placeholder="01012345678"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            )}
            <PurchaseTermsConsent
              checked={form.consent}
              onChange={(consent) => update("consent", consent)}
            />
          </div>
        ) : step === "card" ? (
          <div className="mt-8 grid gap-5">
            <fieldset>
              <legend className="text-xs font-bold text-neutral-300">카드번호</legend>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:gap-3">
                {form.cardNumberParts.map((part, index) => (
                  <input
                    key={index}
                    ref={(element) => { cardPartRefs.current[index] = element; }}
                    data-payment-autofocus={index === 0 ? "" : undefined}
                    required
                    type={index === 3 ? "password" : "text"}
                    inputMode="numeric"
                    autoComplete={index === 0 ? "cc-number" : "off"}
                    aria-label={`카드번호 ${index + 1}번째 4자리`}
                    value={part}
                    onChange={(event) => updateCardNumberPart(index, event.target.value)}
                    onPaste={(event) => pasteCardNumber(index, event)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Backspace"
                        && !form.cardNumberParts[index]
                        && index > 0
                      ) {
                        event.preventDefault();
                        cardPartRefs.current[index - 1]?.focus();
                      }
                    }}
                    maxLength={index === 0 ? 16 : 4}
                    placeholder={index === 3 ? "••••" : "0000"}
                    className="min-h-14 min-w-0 w-full rounded-2xl border border-white/10 bg-[#101315] px-2 text-center text-base font-bold tracking-[.08em] text-white outline-none transition placeholder:font-medium placeholder:tracking-normal placeholder:text-neutral-700 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 sm:px-3"
                  />
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-neutral-300">
                유효기간 월
                <input
                  required
                  inputMode="numeric"
                  autoComplete="cc-exp-month"
                  value={form.expiryMonth}
                  onChange={(event) => update("expiryMonth", digits(event.target.value, 2))}
                  placeholder="MM"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
              <label className="text-xs font-bold text-neutral-300">
                유효기간 연도
                <input
                  required
                  inputMode="numeric"
                  autoComplete="cc-exp-year"
                  value={form.expiryYear}
                  onChange={(event) => update("expiryYear", digits(event.target.value, 2))}
                  placeholder="YY"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                카드 비밀번호 앞 2자리
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.cardPassword}
                  onChange={(event) => update("cardPassword", digits(event.target.value, 2))}
                  placeholder="••"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.identityNumber}
                  onChange={(event) => update("identityNumber", digits(event.target.value, 10))}
                  placeholder="6자리 또는 10자리"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            <label className="text-xs font-bold text-neutral-300">
              휴대전화 번호
              <input
                required
                inputMode="numeric"
                autoComplete="tel"
                value={form.payerTel}
                onChange={(event) => update("payerTel", digits(event.target.value, 11))}
                placeholder="01012345678"
                className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
              />
            </label>
            <PurchaseTermsConsent
              checked={form.consent}
              onChange={(consent) => update("consent", consent)}
            />
          </div>
        ) : (
          <div className="mt-8 grid gap-5">
            <label className="text-xs font-bold text-neutral-300">
              이름
              <input
                data-payment-autofocus
                required
                autoComplete="name"
                value={form.payerName}
                onChange={(event) => update("payerName", event.target.value.slice(0, 20))}
                placeholder="홍길동"
                className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
              />
            </label>
            <label className="text-xs font-bold text-neutral-300">
              이메일
              <input
                required
                type="email"
                autoComplete="email"
                value={form.payerEmail}
                onChange={(event) => update("payerEmail", event.target.value.slice(0, 100))}
                placeholder="name@example.com"
                className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
              />
            </label>
          </div>
        )}
      </ThePayOnePaymentOverlay>

      <PaymentMessageOverlay
        open={Boolean(error)}
        tone="error"
        title={errorTitle}
        message={error || ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
