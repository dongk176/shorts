"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PaymentMethodAction } from "@/lib/contracts";

type FormState = {
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cardPassword: string;
  identityNumber: string;
  payerTel: string;
};

const emptyForm: FormState = {
  cardNumber: "",
  expiryMonth: "",
  expiryYear: "",
  cardPassword: "",
  identityNumber: "",
  payerTel: "",
};

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

function formIsValid(form: FormState) {
  return (
    /^\d{13,19}$/.test(form.cardNumber)
    && /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
    && /^\d{2}$/.test(form.cardPassword)
    && /^(\d{6}|\d{10})$/.test(form.identityNumber)
    && /^\d{10,11}$/.test(form.payerTel)
  );
}

export function PaymentMethodRemediationGate({
  initialAction,
  authenticated,
}: {
  initialAction: PaymentMethodAction;
  authenticated: boolean;
}) {
  const pathname = usePathname();
  const [action, setAction] = useState(initialAction);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const gateOpen = Boolean(action);
  const hasInitialAction = Boolean(initialAction);
  const pollingState = action?.state || null;
  const remediationId = action?.remediationId || null;

  useEffect(() => {
    setAction(initialAction);
  }, [initialAction]);

  useEffect(() => {
    if (!authenticated || hasInitialAction) return;
    const controller = new AbortController();
    void fetch("/api/billing/payment-method-remediations/current", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { action?: PaymentMethodAction };
      if (!controller.signal.aborted && "action" in result) {
        setAction(result.action ?? null);
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [authenticated, hasInitialAction]);

  useEffect(() => {
    if (!gateOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-remediation-autofocus]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [gateOpen]);

  useEffect(() => {
    if (
      !remediationId
      || !pollingState
      || !["required", "registering", "awaiting_provider", "manual_review"].includes(pollingState)
    ) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/billing/payment-method-remediations/current", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const result = await response.json() as { action?: PaymentMethodAction };
        if (!cancelled && response.ok && "action" in result) {
          setAction(result.action ?? null);
        }
      } catch {
        // A later poll retries; the gate remains closed while status is unknown.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollingState, remediationId]);

  if (!action || (action.state === "expired" && pathname.startsWith("/pricing"))) {
    return null;
  }

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    requestIdRef.current = null;
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (busy || action?.state !== "required" || !formIsValid(form)) return;
    setBusy(true);
    setError(null);
    requestIdRef.current ||= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/billing/payment-method-remediations/${encodeURIComponent(action.remediationId)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            requestId: requestIdRef.current,
            payerTel: form.payerTel,
            cardNumber: form.cardNumber,
            expiryYear: form.expiryYear,
            expiryMonth: form.expiryMonth,
            identityNumber: form.identityNumber,
            cardPassword: form.cardPassword,
          }),
        },
      );
      const result = await response.json() as { detail?: string; code?: string };
      if (!response.ok) {
        if (
          result.code === "PAYMENT_METHOD_REVIEW_PENDING"
          || result.code === "PAYMENT_METHOD_REGISTRATION_IN_PROGRESS"
        ) {
          setAction((current) => current ? { ...current, state: "manual_review" } : current);
          return;
        }
        requestIdRef.current = null;
        throw new Error(result.detail || "결제수단을 추가하지 못했습니다.");
      }
      setSuccess(true);
      window.setTimeout(() => window.location.reload(), 1_100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결제수단을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = ["registering", "awaiting_provider", "manual_review"].includes(action.state);
  const expired = action.state === "expired";

  return (
    <div className="fixed inset-0 z-[300] grid place-items-center overflow-y-auto bg-black/85 px-4 py-8 backdrop-blur-md">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="payment-method-remediation-title"
        aria-describedby="payment-method-remediation-description"
        tabIndex={-1}
        className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-[#ff8f80]/20 bg-[#181b1d] shadow-[0_32px_120px_rgba(0,0,0,.8)]"
      >
        <div className="pointer-events-none absolute inset-x-16 -top-24 h-44 rounded-full bg-[#ff715e]/10 blur-3xl" />
        <div className="relative max-h-[calc(100dvh-4rem)] overflow-y-auto px-6 py-7 sm:px-8 sm:py-9">
          {success ? (
            <div className="py-12 text-center" aria-live="polite">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15 text-2xl text-emerald-300">✓</div>
              <h2 id="payment-method-remediation-title" className="mt-5 text-2xl font-black tracking-[-.04em] text-white">
                결제수단이 추가됐어요.
              </h2>
              <p id="payment-method-remediation-description" className="mt-3 text-sm text-neutral-400">
                이지컷 프로를 계속 이용할 수 있어요.
              </p>
            </div>
          ) : expired ? (
            <div className="py-6 text-center">
              <h2 id="payment-method-remediation-title" className="text-2xl font-black tracking-[-.04em] text-white">
                이지컷 프로 구독이 만료되었어요
              </h2>
              <p id="payment-method-remediation-description" className="mt-3 text-sm leading-6 text-neutral-400">
                계속 이용하려면 이지컷 프로를 다시 시작해 주세요.
              </p>
              <Link
                data-remediation-autofocus
                href="/pricing?plan=easycut_pro_v2"
                className="mt-7 inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ef4939] to-[#ff715e] px-5 text-sm font-black text-white"
              >
                이지컷 프로 다시 시작하기
              </Link>
            </div>
          ) : waiting ? (
            <div className="py-12 text-center" aria-live="polite">
              <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[#ff8f80]" aria-hidden="true" />
              <h2 id="payment-method-remediation-title" className="mt-6 text-2xl font-black tracking-[-.04em] text-white">
                구독 상태를 확인하고 있어요.
              </h2>
              <p id="payment-method-remediation-description" className="mt-3 text-sm leading-6 text-neutral-400">
                확인이 끝나면 자동으로 화면이 바뀝니다.
              </p>
            </div>
          ) : (
            <>
              <h2 id="payment-method-remediation-title" className="text-[26px] font-black tracking-[-.04em] text-white sm:text-3xl">
                결제수단 확인이 필요해요
              </h2>
              <p id="payment-method-remediation-description" className="mt-3 text-sm leading-6 text-neutral-400">
                안전한 정기결제 이용을 위해 카드 정보를 다시 확인해 주세요. 지금 별도 결제는 진행되지 않으며, 이지컷 프로 이용 상태도 그대로 유지됩니다.
              </p>

              <form
                className="mt-7 grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="text-xs font-bold text-neutral-300">
                  카드번호
                  <input
                    data-remediation-autofocus
                    required
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={form.cardNumber}
                    onChange={(event) => update("cardNumber", digits(event.target.value, 19))}
                    placeholder="숫자만 입력"
                    className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-bold text-neutral-300">
                    유효기간 월
                    <input required inputMode="numeric" autoComplete="cc-exp-month" value={form.expiryMonth} onChange={(event) => update("expiryMonth", digits(event.target.value, 2))} placeholder="MM" className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70" />
                  </label>
                  <label className="text-xs font-bold text-neutral-300">
                    유효기간 연도
                    <input required inputMode="numeric" autoComplete="cc-exp-year" value={form.expiryYear} onChange={(event) => update("expiryYear", digits(event.target.value, 2))} placeholder="YY" className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 text-xs font-bold text-neutral-300">
                    카드 비밀번호 앞 2자리
                    <input required type="password" inputMode="numeric" autoComplete="off" value={form.cardPassword} onChange={(event) => update("cardPassword", digits(event.target.value, 2))} placeholder="••" className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70" />
                  </label>
                  <label className="min-w-0 text-xs font-bold text-neutral-300">
                    생년월일 또는 사업자번호
                    <input required inputMode="numeric" autoComplete="off" value={form.identityNumber} onChange={(event) => update("identityNumber", digits(event.target.value, 10))} placeholder="6자리 또는 10자리" className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70" />
                  </label>
                </div>
                <label className="text-xs font-bold text-neutral-300">
                  휴대전화 번호
                  <input required inputMode="numeric" autoComplete="tel" value={form.payerTel} onChange={(event) => update("payerTel", digits(event.target.value, 11))} placeholder="01012345678" className="mt-2 min-h-13 w-full rounded-xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8f80]/70" />
                </label>

                {error && <p role="alert" className="rounded-xl bg-red-400/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
                <button
                  type="submit"
                  disabled={busy || !formIsValid(form)}
                  className="mt-2 min-h-13 w-full rounded-xl bg-gradient-to-r from-[#ef4939] to-[#ff715e] px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(239,73,57,.22)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "추가하고 있어요..." : "결제수단 추가"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
