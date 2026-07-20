"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestSubscriptionBillingAuth } from "@/lib/billing-client";
import { discountedMonthlyPrice, estimatedMonthlyShortCount, pricingPlans, yearlyCharge } from "@/lib/pricing";

export type ProPaywallStep = "closed" | "notice" | "pricing";

const won = new Intl.NumberFormat("ko-KR");

export function ProPaywall({
  step,
  onStepChange,
  isAuthenticated,
}: {
  step: ProPaywallStep;
  onStepChange: (step: ProPaywallStep) => void;
  isAuthenticated: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [yearly, setYearly] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const planScrollerRef = useRef<HTMLDivElement | null>(null);
  const standardPlanRef = useRef<HTMLElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (step === "closed") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStepChange("closed");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onStepChange, step]);

  useEffect(() => {
    if (step === "notice") {
      const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (step !== "pricing") return;
    const frame = window.requestAnimationFrame(() => {
      closeRef.current?.focus();
      const scroller = planScrollerRef.current;
      const standard = standardPlanRef.current;
      if (!scroller || !standard || !window.matchMedia("(max-width: 767px)").matches) return;
      scroller.scrollTo({
        left: standard.offsetLeft - (scroller.clientWidth - standard.clientWidth) / 2,
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  if (!mounted || step === "closed") return null;

  const startPlan = async (planCode: "plus" | "standard" | "pro") => {
    setBusyPlan(planCode);
    setCheckoutError(null);
    try {
      await requestSubscriptionBillingAuth({
        mode: "subscribe",
        planCode,
        billingCycle: yearly ? "yearly" : "monthly",
      });
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "구독 결제를 시작하지 못했습니다.");
      setBusyPlan(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="오버레이 닫기"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => onStepChange("closed")}
      />

      {step === "notice" ? (
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="pro-notice-title"
          aria-describedby="pro-notice-description"
          className="login-dialog relative mb-[max(20px,env(safe-area-inset-bottom))] w-[calc(100%-32px)] max-w-[420px] overflow-hidden rounded-[24px] border border-violet-300/20 bg-[#202426] px-6 pb-6 pt-7 text-center shadow-[0_30px_100px_rgba(0,0,0,.7),0_0_44px_rgba(160,120,255,.13)] md:mb-0 md:px-8 md:pb-8 md:pt-9"
        >
          <Image className="mx-auto" src="/east-cut-logo.png" alt="" width={40} height={40} aria-hidden="true" />
          <h2 id="pro-notice-title" className="mt-5 text-[21px] font-black tracking-[-.035em] text-white md:text-2xl">해당 기능은 회원 전용 기능이에요</h2>
          <p id="pro-notice-description" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-neutral-400">나에게 맞는 요금제를 선택해 보세요.</p>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onStepChange("pricing")}
            className="mt-7 min-h-12 w-full rounded-xl bg-[#f04435] px-5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(240,68,53,.24)] transition hover:bg-[#ff5d4d]"
          >
            확인
          </button>
        </section>
      ) : (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="pricing-overlay-title"
          className="login-dialog relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#15191a] shadow-[0_-20px_80px_rgba(0,0,0,.65)] md:max-h-[calc(100dvh-40px)] md:max-w-[1240px] md:rounded-[28px] md:shadow-[0_34px_120px_rgba(0,0,0,.7),0_0_60px_rgba(160,120,255,.1)]"
        >
          <div className="mx-auto mt-3 h-1 w-11 rounded-full bg-white/20 md:hidden" aria-hidden="true" />
          <header className="relative shrink-0 px-16 pb-3 pt-5 text-center md:px-20 md:pb-4 md:pt-6">
            <div className="mx-auto max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-300">Upgrade your plan</p>
              <h2 id="pricing-overlay-title" className="mt-1.5 text-xl font-black tracking-[-.04em] text-white md:text-[28px]">내게 맞는 플랜을 선택하세요</h2>
              <p className="mt-1.5 text-xs leading-5 text-neutral-400 md:text-sm">연간 결제 시 20% 할인되며, 모든 플랜에서 템플릿 4종을 사용할 수 있습니다.</p>
              {checkoutError && <p role="alert" className="mt-2 text-xs font-bold text-red-300">{checkoutError}</p>}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => onStepChange("closed")}
              aria-label="요금제 선택 닫기"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[.04] text-lg text-neutral-400 transition hover:border-white/20 hover:text-white md:right-6 md:top-6"
            >
              ×
            </button>
          </header>

          <div className="flex shrink-0 justify-center px-5 pb-3">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#202426] p-1" role="group" aria-label="결제 주기">
              <button type="button" onClick={() => setYearly(false)} className={`min-h-9 rounded-full px-4 text-xs font-extrabold transition ${!yearly ? "bg-white/10 text-white shadow-[0_3px_14px_rgba(0,0,0,.28)]" : "text-neutral-500 hover:text-neutral-300"}`}>월간 결제</button>
              <button type="button" onClick={() => setYearly(true)} className={`min-h-9 rounded-full px-4 text-xs font-extrabold transition ${yearly ? "bg-white/10 text-white shadow-[0_3px_14px_rgba(0,0,0,.28)]" : "text-neutral-500 hover:text-neutral-300"}`}>연간 결제</button>
            </div>
          </div>

          <div
            ref={planScrollerRef}
            className="paywall-plan-scroller grid min-h-0 flex-1 auto-cols-[82vw] grid-flow-col content-start gap-3 overflow-x-auto overflow-y-auto snap-x snap-mandatory px-[9vw] pb-5 pt-3 md:grid-flow-row md:auto-cols-auto md:grid-cols-3 md:gap-5 md:px-8 md:pb-3 md:pt-3"
            role="group"
            aria-label="요금제"
          >
            {pricingPlans.map((plan) => {
              const planMonthly = yearly ? discountedMonthlyPrice(plan.monthly) : plan.monthly;
              const pricingPath = `/pricing?plan=${plan.code}&cycle=${yearly ? "yearly" : "monthly"}`;
              const continueHref = isAuthenticated
                ? pricingPath
                : `/auth/sign-in?next=${encodeURIComponent(pricingPath)}`;
              return (
                <article
                  key={plan.code}
                  ref={plan.code === "standard" ? standardPlanRef : undefined}
                  data-checkout-plan={plan.code}
                  className={`relative flex min-h-[410px] snap-center flex-col rounded-[22px] border p-5 transition ${plan.popular ? "border-[#ff8b7c]/75 bg-[#202426] shadow-[0_0_36px_rgba(255,85,64,.11)]" : "border-white/10 bg-[#1a1e20]"}`}
                >
                  {plan.badge && <span className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-black ${plan.code === "pro" ? "bg-violet-400 text-[#23005c]" : "bg-[#ff715e] text-[#410000]"}`}>{plan.badge}</span>}
                  <h3 className="text-xl font-black text-[#ffad9f]">{plan.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1"><strong className="text-[28px] font-black tracking-[-.05em] text-white">{won.format(planMonthly)}원</strong><span className="text-xs text-neutral-500">/월</span></div>
                  <p className="mt-1 min-h-5 text-[11px] text-neutral-600">{yearly ? `연 ${won.format(yearlyCharge(plan.monthly))}원 결제` : "월 단위 결제"}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[.035] px-3.5 py-2.5"><span><strong className="block text-sm text-white">월 {plan.minutes}분</strong><span className="mt-0.5 block text-[10px] text-neutral-500">원본 영상 처리</span></span><span className="text-right text-[11px] font-extrabold text-[#ffad9f]">쇼츠 약 {estimatedMonthlyShortCount(plan.minutes)}개<small className="mt-0.5 block font-medium text-neutral-500">10분 영상 기준</small></span></div>
                  <ul className="mt-3 flex shrink-0 flex-col gap-1.5">
                    {plan.features.map((feature) => <li key={feature} className="flex gap-2 text-[11px] leading-5 text-neutral-300 md:text-xs"><span className="text-[#ff8c7c]" aria-hidden="true">✓</span>{feature}</li>)}
                  </ul>
                  {isAuthenticated ? (
                    <button type="button" disabled={busyPlan !== null} onClick={() => void startPlan(plan.code)} className={`mt-auto flex min-h-10 shrink-0 translate-y-1 items-center justify-center rounded-xl border px-4 text-xs font-extrabold transition disabled:opacity-60 ${plan.popular ? "border-[#ff715e] bg-[#ff715e] text-[#410000] hover:bg-[#ff806e]" : "border-white/15 text-white hover:border-[#ffb4a8] hover:bg-[#ffb4a8]/[.06]"}`}>{busyPlan === plan.code ? "준비 중..." : `${plan.name} 시작하기`}</button>
                  ) : (
                    <Link href={continueHref} className={`mt-auto flex min-h-10 shrink-0 translate-y-1 items-center justify-center rounded-xl border px-4 text-xs font-extrabold transition ${plan.popular ? "border-[#ff715e] bg-[#ff715e] text-[#410000] hover:bg-[#ff806e]" : "border-white/15 text-white hover:border-[#ffb4a8] hover:bg-[#ffb4a8]/[.06]"}`}>로그인하고 시작하기</Link>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>,
    document.body,
  );
}
