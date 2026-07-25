"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import { billingPostJson } from "@/lib/billing-client";
import type { PricingV2PlanProduct } from "@/lib/pricing-v2";

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
  onClose,
}: {
  mode: CheckoutMode;
  product: PricingV2PlanProduct;
  initialName?: string | null;
  initialEmail?: string | null;
  onClose: () => void;
}) {
  const termsConsentId = useId();
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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("purchase-sheet-open");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("purchase-sheet-open");
    };
  }, [busy, onClose]);

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

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex items-end bg-black/80 pt-8 backdrop-blur-md sm:grid sm:place-items-center sm:overflow-y-auto sm:px-5 sm:py-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-checkout-overlay-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "card") {
              void verifyCard();
              return;
            }
            void completePayment();
          }}
          className="relative flex h-[calc(100dvh-0.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-[30px] border border-[#ff8f80]/20 bg-[#181b1d] shadow-[0_30px_100px_rgba(0,0,0,.72),0_0_70px_rgba(255,113,94,.08)] sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:rounded-[30px]"
        >
          <div className="pointer-events-none absolute inset-x-20 -top-24 h-44 rounded-full bg-[#ff715e]/10 blur-3xl" />
          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-7 pt-3 sm:px-8 sm:pt-8">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white">
                  <Image
                    src="/thepayone-mark.png"
                    alt=""
                    width={30}
                    height={38}
                    className="h-8 w-auto object-contain"
                  />
                </span>
                <strong className="text-lg font-black tracking-[-.03em] text-white sm:text-xl">더페이원</strong>
              </div>
              <button
                type="button"
                aria-label="결제창 닫기"
                disabled={busy}
                onClick={onClose}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl text-neutral-400 transition hover:border-white/20 hover:bg-white/[.06] hover:text-white disabled:opacity-40"
              >
                ×
              </button>
            </div>
            <h2 id="plan-checkout-overlay-title" className="mt-7 text-[28px] font-black tracking-[-.04em] text-white">
              {step === "card" ? "카드 정보" : "결제자 정보"}
            </h2>

            {step === "card" ? (
              <div className="mt-8 grid gap-5">
                <fieldset>
                  <legend className="text-xs font-bold text-neutral-300">카드번호</legend>
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:gap-3">
                    {form.cardNumberParts.map((part, index) => (
                      <input
                        key={index}
                        ref={(element) => { cardPartRefs.current[index] = element; }}
                        autoFocus={index === 0}
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
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4">
                  <input
                    id={termsConsentId}
                    type="checkbox"
                    checked={form.consent}
                    onChange={(event) => update("consent", event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
                    aria-label="[필수] 구매약관 및 취소·환불 규정 동의"
                  />
                  <p className="text-xs font-medium leading-6 text-neutral-300">
                    <label htmlFor={termsConsentId} className="cursor-pointer">
                      <strong className="text-[#ff9b8d]">[필수]</strong>{" "}
                    </label>
                    <Link
                      href="/purchase-terms"
                      target="_blank"
                      rel="noreferrer"
                      className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
                    >
                      구매약관
                    </Link>
                    <span> 및 </span>
                    <Link
                      href="/refund"
                      target="_blank"
                      rel="noreferrer"
                      className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
                    >
                      취소·환불 규정
                    </Link>
                    <label htmlFor={termsConsentId} className="cursor-pointer">
                      을 확인했으며 이에 동의합니다.
                    </label>
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-8 grid gap-5">
                <p className="text-sm leading-6 text-neutral-400">
                  0원 카드 확인과 최종 결제에 사용됩니다.
                </p>
                <label className="text-xs font-bold text-neutral-300">
                  이름
                  <input
                    required
                    autoFocus
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
          </div>

          <div className={`sticky bottom-0 z-10 grid flex-none gap-3 border-t border-white/10 bg-[#181b1d]/98 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 ${
            step === "payer" ? "grid-cols-[auto_1fr]" : "grid-cols-1"
          }`}>
            {step === "payer" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep("card")}
                className="min-h-[52px] rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                이전
              </button>
            )}
            <button
              type="submit"
              disabled={busy || (step === "card" ? !cardStepValid : !payerStepValid)}
              className="min-h-[52px] w-full rounded-xl bg-gradient-to-r from-[#ef4939] to-[#ff715e] px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(239,73,57,.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {step === "card"
                ? busy
                  ? "카드를 확인하고 있습니다..."
                  : "다음"
                : busy
                  ? "결제를 진행하고 있습니다..."
                  : chargeAmount === null
                    ? "결제금액 확인 중..."
                    : "확인"}
            </button>
          </div>
        </form>
      </div>

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
