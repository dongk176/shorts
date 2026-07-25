"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paidPlanCodes, type PaidPlanCode } from "@/lib/contracts";
import { billingPostJson } from "@/lib/billing-client";
import { pricingPlans, yearlyCharge } from "@/lib/legacy-pricing";
import { getPricingV2Plan } from "@/lib/pricing-v2";
import { PurchaseTermsConsent } from "@/components/purchase-terms-consent";
import { PaymentMessageOverlay } from "@/components/payment-message-overlay";

const legacyPlanNames: Partial<Record<PaidPlanCode, string>> = {
  plus: "Plus",
  standard: "Standard",
  pro: "Pro",
};
const priceFormatter = new Intl.NumberFormat("ko-KR");

function planName(planCode: PaidPlanCode) {
  return getPricingV2Plan(planCode)?.displayName || legacyPlanNames[planCode] || planCode.toUpperCase();
}

type FormState = {
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  identityNumber: string;
  cardPassword: string;
  consent: boolean;
};

type ChangeQuote = {
  action: "immediate_proration" | "immediate_annual_conversion" | "renewal";
  chargeAmountKrw: number;
  providerChargeAmountKrw: number;
  prorationCreditKrw: number;
  fullCurrentPaymentRefund: boolean;
  currentPlanDisplayName?: string | null;
  effectiveAt: string;
  nextChargeAt: string;
};

type ActivationResult = {
  checkoutId?: string;
  refund?: { mode: string; amountKrw: number; processingBusinessDays: number };
};

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

function formattedCardNumber(value: string) {
  return digits(value, 19).replace(/(.{4})/g, "$1 ").trim();
}

function MonthlySubscriptionConfirmation({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onCancel, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="monthly-subscription-confirmation-title"
        aria-describedby="monthly-subscription-confirmation-description"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          if (event.shiftKey && document.activeElement === confirmButtonRef.current) {
            event.preventDefault();
            cancelButtonRef.current?.focus();
          } else if (!event.shiftKey && document.activeElement === cancelButtonRef.current) {
            event.preventDefault();
            confirmButtonRef.current?.focus();
          }
        }}
        className="relative w-full max-w-[440px] overflow-hidden rounded-[26px] border border-amber-300/20 bg-[#202124] p-7 text-center shadow-[0_32px_100px_rgba(0,0,0,.72),0_0_48px_rgba(251,191,36,.08)] sm:p-9"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full bg-amber-400/10 blur-3xl" />
        <div aria-hidden="true" className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-amber-300/25 bg-amber-300/10 text-xl font-black text-amber-200">!</div>
        <p className="relative mt-5 text-[11px] font-black uppercase tracking-[.18em] text-amber-300">월간 구독 안내</p>
        <h2 id="monthly-subscription-confirmation-title" className="relative mt-2 text-2xl font-black tracking-[-.04em] text-white">
          월간 구독으로 진행하시겠습니까?
        </h2>
        <div id="monthly-subscription-confirmation-description" className="relative mt-4 text-sm leading-6 text-neutral-400">
          <p>월간 구독에서는 아래 혜택을 이용할 수 없습니다.</p>
          <ul className="mx-auto mt-4 grid max-w-[300px] gap-2 text-left text-neutral-200">
            <li className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-4 py-3"><span aria-hidden="true" className="text-amber-300">!</span><span className="font-bold">실시간 인기 필터</span></li>
            <li className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-4 py-3"><span aria-hidden="true" className="text-amber-300">!</span><span className="font-bold">전자책</span></li>
          </ul>
        </div>
        <div className="relative mt-7 grid gap-2.5">
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff8a78] active:scale-[.99]"
          >
            월간 구독으로 진행
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/25 hover:text-white"
          >
            돌아가기
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function BillingCheckoutClient() {
  const params = useSearchParams();
  const rawMode = params.get("mode");
  const mode = (["subscribe", "change_subscription", "replace_payment_method", "renew_annual"] as const)
    .find((value) => value === rawMode) || "subscribe";
  const rawPlan = params.get("plan");
  const rawCycle = params.get("cycle");
  const planCode = paidPlanCodes.find((code) => code === rawPlan) || null;
  const billingCycle = (["monthly", "yearly"] as const).find((cycle) => cycle === rawCycle) || null;
  const needsPlanSelection = mode === "subscribe" || mode === "change_subscription";
  const invalidSubscribeRequest = needsPlanSelection && (!planCode || !billingCycle);
  const selectedLegacyPlan = pricingPlans.find((plan) => plan.code === planCode) || null;
  const selectedPricingV2Plan = getPricingV2Plan(planCode);
  const selectedPlan = selectedLegacyPlan
    ? {
      code: selectedLegacyPlan.code as PaidPlanCode,
      monthly: selectedLegacyPlan.monthly,
      minutes: selectedLegacyPlan.minutes,
    }
    : selectedPricingV2Plan
      ? {
        code: selectedPricingV2Plan.code as PaidPlanCode,
        monthly: selectedPricingV2Plan.monthlyPriceKrw,
        minutes: selectedPricingV2Plan.monthlyMinutes,
      }
      : null;
  const regularChargeAmount = selectedPlan && billingCycle
    ? selectedPricingV2Plan
      ? selectedPricingV2Plan.totalPriceKrw
      : billingCycle === "yearly" ? yearlyCharge(selectedPlan.monthly) : selectedPlan.monthly
    : null;
  const pricingReturnPath = "/pricing";
  const title = mode === "subscribe"
    ? selectedPricingV2Plan?.kind === "package" ? "패키지 구매하기" : "구독 시작하기"
    : mode === "change_subscription"
      ? "새 플랜으로 변경하기"
      : mode === "renew_annual"
        ? "연간 구독 갱신하기"
        : "결제 카드 변경하기";
  const description = needsPlanSelection && planCode && billingCycle
    ? mode === "change_subscription"
      ? `${planName(planCode)}의 변경 금액을 확인한 뒤 결제합니다. 즉시 변경 대상은 결제 성공과 함께 적용됩니다.`
      : selectedPricingV2Plan?.kind === "package"
        ? `${selectedPricingV2Plan.displayName}을 한 번 결제합니다. 자동결제 없이 결제 완료일부터 매월 ${selectedPricingV2Plan.monthlyMinutes}분이 지급됩니다.`
        : `${planName(planCode)} ${billingCycle === "yearly" ? "연간" : "월간"} 플랜을 선택하셨습니다. 결제가 완료되면 바로 이용할 수 있습니다.`
    : mode === "renew_annual"
      ? "현재 이용 중인 연간 플랜을 갱신합니다. 결제가 완료되면 기존 만료일 다음 날부터 1년 연장됩니다."
      : mode === "replace_payment_method"
        ? "앞으로 정기결제에 사용할 새 카드 정보를 입력해 주세요. 카드 확인이 완료되면 바로 변경됩니다."
        : "가격 페이지에서 플랜과 결제 주기를 다시 선택해 주세요.";
  const [form, setForm] = useState<FormState>({
    payerName: "",
    payerEmail: "",
    payerTel: "",
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    identityNumber: "",
    cardPassword: "",
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeQuote, setChangeQuote] = useState<ChangeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(mode === "change_subscription");
  const [monthlyConfirmationOpen, setMonthlyConfirmationOpen] = useState(false);

  useEffect(() => {
    if (mode !== "change_subscription" || !planCode || !billingCycle) {
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ planCode, billingCycle });
    setQuoteLoading(true);
    fetch(`/api/billing/subscription/change?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as ChangeQuote & { detail?: string };
        if (!response.ok) throw new Error(value.detail || "플랜 변경 금액을 불러오지 못했습니다.");
        setChangeQuote(value);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "플랜 변경 금액을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [billingCycle, mode, planCode]);

  const chargeAmount = mode === "change_subscription"
    ? changeQuote?.chargeAmountKrw ?? null
    : regularChargeAmount;

  const submitLabel = busy
    ? "결제를 진행하고 있습니다..."
    : mode === "replace_payment_method"
      ? "결제 카드 변경하기"
      : mode === "renew_annual"
        ? "연간 구독 갱신하기"
        : chargeAmount !== null
          ? `${priceFormatter.format(chargeAmount)}원 결제하기`
          : "결제하고 시작하기";

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const valid = Boolean(
    !invalidSubscribeRequest
    && (mode !== "change_subscription" || Boolean(changeQuote))
    && form.payerName.trim()
    && form.payerEmail.trim()
    && digits(form.payerTel, 11).length >= 10
    && digits(form.cardNumber, 19).length >= 13
    && /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
    && [6, 10].includes(digits(form.identityNumber, 10).length)
    && digits(form.cardPassword, 2).length === 2
    && form.consent,
  );

  async function completePayment() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await billingPostJson<ActivationResult>("/api/billing/activate", {
        mode,
        requestId: crypto.randomUUID(),
        ...(needsPlanSelection ? { planCode, billingCycle } : {}),
        payerName: form.payerName.trim(),
        payerEmail: form.payerEmail.trim(),
        payerTel: digits(form.payerTel, 11),
        cardNumber: digits(form.cardNumber, 19),
        expiryYear: form.expiryYear,
        expiryMonth: form.expiryMonth,
        identityNumber: digits(form.identityNumber, 10),
        cardPassword: digits(form.cardPassword, 2),
        consent: true,
        installmentMonths: 0,
        installmentCampaignId: null,
      });
      const success = new URL("/billing/success", window.location.origin);
      success.searchParams.set("flow", "subscription");
      success.searchParams.set("status", mode === "replace_payment_method" ? "payment_method_updated" : "activated");
      if (result.checkoutId) success.searchParams.set("checkoutId", result.checkoutId);
      if (selectedPricingV2Plan) success.searchParams.set("source", "pricing");
      window.location.assign(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "정기결제를 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    if (billingCycle === "monthly" && !selectedPricingV2Plan) {
      setMonthlyConfirmationOpen(true);
      return;
    }
    void completePayment();
  }

  function confirmMonthlySubscription() {
    setMonthlyConfirmationOpen(false);
    void completePayment();
  }

  return (
    <>
      <main className="app-shell min-h-screen px-5 py-8 text-neutral-100 sm:py-12">
        <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-black tracking-[-.04em] text-white">Easy Cut</Link>
          <Link href={pricingReturnPath} className="text-xs font-bold text-neutral-400 transition hover:text-white">요금제로 돌아가기</Link>
        </header>

          <section className="rounded-[28px] border border-white/10 bg-[#191c1e]/95 p-6 shadow-2xl sm:p-9">
            <h1 className="text-[30px] font-black tracking-[-.04em] text-white">{title}</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-neutral-400">{description}</p>

            {invalidSubscribeRequest ? (
              <Link href={pricingReturnPath} className="mt-7 flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white">플랜 다시 선택하기</Link>
            ) : (
              <form onSubmit={submit} className="mt-8">
                <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2 disabled:opacity-70">
                  <legend className="sr-only">구독 결제 정보</legend>
                  <h2 className="mb-1 border-b border-white/8 pb-4 text-sm font-black text-white sm:col-span-2">결제자 정보</h2>
                  <label className="text-xs font-bold text-neutral-300">이름<input required value={form.payerName} onChange={(event) => update("payerName", event.target.value.slice(0, 20))} autoComplete="name" placeholder="홍길동" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                  <label className="text-xs font-bold text-neutral-300">이메일<input required type="email" value={form.payerEmail} onChange={(event) => update("payerEmail", event.target.value.slice(0, 60))} autoComplete="email" placeholder="name@example.com" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                  <label className="text-xs font-bold text-neutral-300 sm:col-span-2">휴대전화 번호<input required inputMode="numeric" value={form.payerTel} onChange={(event) => update("payerTel", digits(event.target.value, 11))} placeholder="01012345678" autoComplete="tel" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /><span className="mt-2 block text-[11px] font-medium leading-5 text-neutral-500">결제 연락처는 암호화해 저장하며, 다음 추가 시간 결제에서 다시 입력하지 않도록 사용합니다.</span></label>

                  <h2 className="mb-1 mt-3 border-b border-white/8 pb-4 text-sm font-black text-white sm:col-span-2">카드 정보</h2>
                  <label className="text-xs font-bold text-neutral-300 sm:col-span-2">카드번호<input required type="password" inputMode="numeric" value={formattedCardNumber(form.cardNumber)} onChange={(event) => update("cardNumber", digits(event.target.value, 19))} placeholder="•••• •••• •••• ••••" autoComplete="cc-number" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm tracking-[.08em] text-white outline-none transition placeholder:tracking-normal placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-neutral-300">유효기간 월<input required inputMode="numeric" value={form.expiryMonth} onChange={(event) => update("expiryMonth", digits(event.target.value, 2))} placeholder="MM" autoComplete="cc-exp-month" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                    <label className="text-xs font-bold text-neutral-300">유효기간 연도<input required inputMode="numeric" value={form.expiryYear} onChange={(event) => update("expiryYear", digits(event.target.value, 2))} placeholder="YY" autoComplete="cc-exp-year" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                  </div>
                  <label className="text-xs font-bold text-neutral-300">카드 비밀번호 앞 2자리<input required type="password" inputMode="numeric" value={form.cardPassword} onChange={(event) => update("cardPassword", digits(event.target.value, 2))} placeholder="••" autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /></label>
                  <label className="text-xs font-bold text-neutral-300 sm:col-span-2">생년월일 또는 사업자번호<input required inputMode="numeric" value={form.identityNumber} onChange={(event) => update("identityNumber", digits(event.target.value, 10))} placeholder="생년월일 6자리 또는 사업자번호 10자리" autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff9b8d]/60 focus:ring-2 focus:ring-[#ff715e]/10" /><span className="mt-2 block text-[11px] font-medium leading-5 text-neutral-500">개인카드는 생년월일 6자리, 법인카드는 사업자번호 10자리를 입력해 주세요.</span></label>

                  <div className="sm:col-span-2 rounded-2xl border border-white/10 bg-black/15 p-4">
                    <span className="text-xs font-bold text-neutral-300">결제 방식</span>
                    <strong className="mt-2 block text-sm text-white">신용카드 일시불</strong>
                  </div>

                  {mode === "replace_payment_method" ? (
                    <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-black/15 p-4 text-xs leading-6 text-neutral-300">
                      <input type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#ff715e]" />
                      <span>새 카드를 정기결제 수단으로 등록하는 데 동의합니다.</span>
                    </label>
                  ) : (
                    <PurchaseTermsConsent
                      checked={form.consent}
                      onChange={(consent) => update("consent", consent)}
                      className="sm:col-span-2"
                    />
                  )}
                  <button type="submit" disabled={!valid || busy || quoteLoading} className="sm:col-span-2 min-h-13 rounded-xl bg-[#ff715e] px-5 py-3.5 text-sm font-black text-white shadow-[0_14px_32px_rgba(255,113,94,.18)] transition hover:bg-[#ff806f] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">{quoteLoading ? "변경 금액 계산 중..." : submitLabel}</button>
                  <Link href={pricingReturnPath} className="sm:col-span-2 text-center text-xs font-bold text-neutral-500 transition hover:text-neutral-300">취소</Link>
                </fieldset>
              </form>
            )}
          </section>
        </div>
      </main>
      <MonthlySubscriptionConfirmation
        open={monthlyConfirmationOpen}
        onCancel={() => setMonthlyConfirmationOpen(false)}
        onConfirm={confirmMonthlySubscription}
      />
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
