"use client";

import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import { PurchaseTermsConsent } from "@/components/purchase-terms-consent";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import { replaceStoredPaymentMethod } from "@/lib/billing-client";
import { useRef, useState } from "react";

export type ReplacementCardAuth = {
  identityNumber: string;
  cardPassword: string;
};

type ReplacementCardForm = {
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

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

export function ReplacementCardPaymentOverlay({
  initialName,
  initialEmail,
  onClose,
  onUseSavedCard,
  onPaymentMethodReplaced,
}: {
  initialName?: string | null;
  initialEmail?: string | null;
  onClose: () => void;
  onUseSavedCard: () => void;
  onPaymentMethodReplaced: (auth: ReplacementCardAuth) => Promise<void>;
}) {
  const [step, setStep] = useState<"card" | "payer">("card");
  const [form, setForm] = useState<ReplacementCardForm>({
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
  const cardPartRefs = useRef<Array<HTMLInputElement | null>>([]);
  const requestIdRef = useRef<string | null>(null);
  const paymentMethodReplacedRef = useRef(false);
  const operationInFlightRef = useRef(false);
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
    form.payerName.trim()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.payerEmail.trim()),
  );

  function update<Key extends keyof ReplacementCardForm>(
    key: Key,
    value: ReplacementCardForm[Key],
  ) {
    if (!paymentMethodReplacedRef.current) requestIdRef.current = null;
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

  async function replaceAndPay() {
    if (!payerStepValid || busy || operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const auth = {
        identityNumber: digits(form.identityNumber, 10),
        cardPassword: digits(form.cardPassword, 2),
      };
      if (!paymentMethodReplacedRef.current) {
        requestIdRef.current ||= crypto.randomUUID();
        await replaceStoredPaymentMethod({
          requestId: requestIdRef.current,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber,
          expiryYear: form.expiryYear,
          expiryMonth: form.expiryMonth,
          ...auth,
        });
        paymentMethodReplacedRef.current = true;
      }
      await onPaymentMethodReplaced(auth);
    } catch (cause) {
      if (!paymentMethodReplacedRef.current) requestIdRef.current = null;
      const message = cause instanceof Error
        ? cause.message
        : "새 카드 등록 또는 결제를 완료하지 못했습니다.";
      setError(paymentMethodReplacedRef.current
        ? `새 카드는 등록됐지만 결제를 완료하지 못했습니다. 다시 시도해 주세요. ${message}`
        : message);
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <ThePayOnePaymentOverlay
        title={step === "card" ? "카드 정보" : "결제자 정보"}
        busy={busy}
        primaryDisabled={step === "card" ? !cardStepValid : !payerStepValid}
        primaryLabel={busy
          ? "카드를 등록하고 결제하고 있습니다..."
          : step === "card" ? "다음" : "확인"}
        secondaryLabel={step === "card" ? "등록 카드 사용" : "이전"}
        onClose={onClose}
        onSecondary={step === "card" ? onUseSavedCard : () => setStep("card")}
        onSubmit={() => {
          if (step === "card") {
            setStep("payer");
          } else {
            void replaceAndPay();
          }
        }}
      >
        {step === "card" ? (
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
                      if (event.key === "Backspace" && !part && index > 0) {
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
                  data-payment-advance-at="2"
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
                  data-payment-advance-at="2"
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
                  data-payment-advance-at="2"
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
                  data-payment-advance-at="6,10"
                  data-payment-advance-delay="400"
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
                data-payment-advance-at="10,11"
                data-payment-advance-delay="400"
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
        title="결제를 확인해 주세요"
        message={error || ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
