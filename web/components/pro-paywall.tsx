"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ProPaywallStep = "closed" | "notice" | "pricing";

type CheckoutPlanCode = "plus" | "standard" | "pro";

type CheckoutPlan = {
  code: CheckoutPlanCode;
  name: string;
  icon: string;
  monthly: number;
  minutes: number;
  description: string;
  badge?: string;
  features: string[];
};

const checkoutPlans: CheckoutPlan[] = [
  {
    code: "plus",
    name: "Plus",
    icon: "↗",
    monthly: 9_900,
    minutes: 100,
    description: "쇼츠 제작을 시작하는 개인 크리에이터",
    features: ["AI 하이라이트 자동 추출", "월 100분 영상 처리", "쇼츠 자동 자막", "30일 프로젝트 보관"],
  },
  {
    code: "standard",
    name: "Standard",
    icon: "★",
    monthly: 19_900,
    minutes: 300,
    description: "꾸준히 콘텐츠를 만드는 성장형 채널",
    badge: "가장 인기 있는 플랜",
    features: ["Plus의 모든 기능", "월 300분 영상 처리", "우선 작업 처리", "고급 쇼츠 템플릿"],
  },
  {
    code: "pro",
    name: "Pro",
    icon: "◆",
    monthly: 39_900,
    minutes: 600,
    description: "고급 필터와 여러 채널이 필요한 크리에이터",
    features: ["Standard의 모든 기능", "월 600분 영상 처리", "실시간 트렌드 고급 필터", "프로젝트 장기 관리"],
  },
];

const won = new Intl.NumberFormat("ko-KR");

function isCheckoutPlanCode(value: string | undefined): value is CheckoutPlanCode {
  return value === "plus" || value === "standard" || value === "pro";
}

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
  const [yearly, setYearly] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState<CheckoutPlanCode>("standard");
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
    setSelectedPlanCode("standard");
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

  const selectedPlan = checkoutPlans.find((plan) => plan.code === selectedPlanCode) || checkoutPlans[1];
  const displayedMonthly = yearly
    ? Math.round(selectedPlan.monthly * 0.8 / 100) * 100
    : selectedPlan.monthly;
  const pricingPath = `/pricing?plan=${selectedPlan.code}&cycle=${yearly ? "yearly" : "monthly"}`;
  const continueHref = isAuthenticated
    ? pricingPath
    : `/auth/sign-in?next=${encodeURIComponent(pricingPath)}`;

  const selectNearestPlan = () => {
    const scroller = planScrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    const cards = Array.from(scroller.querySelectorAll<HTMLElement>("[data-checkout-plan]"));
    const nearest = cards.reduce<HTMLElement | null>((current, card) => {
      if (!current) return card;
      const cardDistance = Math.abs(card.offsetLeft + card.clientWidth / 2 - center);
      const currentDistance = Math.abs(current.offsetLeft + current.clientWidth / 2 - center);
      return cardDistance < currentDistance ? card : current;
    }, null);
    const code = nearest?.dataset.checkoutPlan;
    if (isCheckoutPlanCode(code)) setSelectedPlanCode(code);
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
          className="login-dialog relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#15191a] shadow-[0_-20px_80px_rgba(0,0,0,.65)] md:max-h-[calc(100dvh-48px)] md:max-w-[1180px] md:rounded-[28px] md:shadow-[0_34px_120px_rgba(0,0,0,.7),0_0_60px_rgba(160,120,255,.1)]"
        >
          <div className="mx-auto mt-3 h-1 w-11 rounded-full bg-white/20 md:hidden" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 md:px-8 md:pb-5 md:pt-7">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-300">Upgrade your plan</p>
              <h2 id="pricing-overlay-title" className="mt-2 text-xl font-black tracking-[-.035em] text-white md:text-2xl">내게 맞는 플랜을 선택하세요</h2>
              <p className="mt-1.5 text-xs leading-5 text-neutral-500 md:text-sm">언제든 플랜을 변경하거나 해지할 수 있어요.</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => onStepChange("closed")}
              aria-label="요금제 선택 닫기"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.04] text-lg text-neutral-400 transition hover:border-white/20 hover:text-white"
            >
              ×
            </button>
          </header>

          <div className="flex shrink-0 justify-center px-5 pb-4">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#202426] p-1" role="group" aria-label="결제 주기">
              <button type="button" onClick={() => setYearly(false)} className={`rounded-full px-4 py-2 text-xs font-extrabold transition ${!yearly ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-300"}`}>월간</button>
              <button type="button" onClick={() => setYearly(true)} className={`rounded-full px-4 py-2 text-xs font-extrabold transition ${yearly ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-300"}`}>연간</button>
              <span className="mr-1 rounded-full bg-[#ff715e]/15 px-2 py-1 text-[10px] font-black text-[#ff9b8d]">20% 할인</span>
            </div>
          </div>

          <div
            ref={planScrollerRef}
            onScroll={selectNearestPlan}
            className="paywall-plan-scroller grid min-h-0 flex-1 auto-cols-[82vw] grid-flow-col gap-3 overflow-x-auto overflow-y-auto snap-x snap-mandatory px-[9vw] pb-5 pt-3 md:grid-flow-row md:auto-cols-auto md:grid-cols-3 md:gap-4 md:overflow-y-auto md:px-8 md:pb-6 md:pt-4"
            role="radiogroup"
            aria-label="요금제"
          >
            {checkoutPlans.map((plan) => {
              const planMonthly = yearly ? Math.round(plan.monthly * 0.8 / 100) * 100 : plan.monthly;
              const selected = selectedPlanCode === plan.code;
              return (
                <article
                  key={plan.code}
                  ref={plan.code === "standard" ? standardPlanRef : undefined}
                  data-checkout-plan={plan.code}
                  className={`relative flex min-h-[390px] snap-center flex-col rounded-[22px] border p-5 transition md:min-h-[420px] md:p-6 ${selected ? "border-[#ff8b7c]/75 bg-[#202426] shadow-[0_0_36px_rgba(255,85,64,.11)]" : "border-white/10 bg-[#1a1e20]"}`}
                >
                  {plan.badge && <span className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-black ${plan.code === "pro" ? "bg-violet-400 text-[#23005c]" : "bg-[#ff715e] text-[#410000]"}`}>{plan.badge}</span>}
                  <div className="flex items-center gap-3 text-[#ffad9f]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ff715e]/10" aria-hidden="true">{plan.icon}</span><h3 className="text-xl font-black">{plan.name}</h3></div>
                  <p className="mt-3 min-h-10 text-xs leading-5 text-neutral-500">{plan.description}</p>
                  <div className="mt-5 flex items-baseline gap-1"><strong className="text-[28px] font-black tracking-[-.05em] text-white">{won.format(planMonthly)}원</strong><span className="text-xs text-neutral-500">/월</span></div>
                  <p className="mt-1 min-h-5 text-[11px] text-neutral-600">{yearly ? `연 ${won.format(planMonthly * 12)}원 결제` : "월 단위 결제"}</p>
                  <div className="mt-4 rounded-xl bg-white/[.035] px-4 py-3"><strong className="block text-sm text-white">월 {plan.minutes}분</strong><span className="mt-0.5 block text-[10px] text-neutral-500">원본 영상 처리</span></div>
                  <ul className="mt-4 flex flex-1 flex-col gap-2.5">
                    {plan.features.map((feature) => <li key={feature} className="flex gap-2 text-xs leading-5 text-neutral-300"><span className="text-[#ff8c7c]" aria-hidden="true">✓</span>{feature}</li>)}
                  </ul>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedPlanCode(plan.code)}
                    className={`mt-5 min-h-10 rounded-xl border px-4 text-xs font-extrabold transition ${selected ? "border-[#ff715e] bg-[#ff715e]/15 text-[#ffc0b7]" : "border-white/10 text-neutral-400 hover:border-white/25 hover:text-white"}`}
                  >
                    {selected ? "선택됨" : "이 플랜 선택"}
                  </button>
                </article>
              );
            })}
          </div>

          <footer className="shrink-0 border-t border-white/[.08] bg-[#15191a]/95 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl md:flex md:items-center md:justify-between md:px-8 md:pb-6 md:pt-5">
            <div className="mb-3 flex items-center justify-between gap-4 md:mb-0 md:justify-start">
              <div><span className="text-[10px] font-bold text-neutral-600">선택한 플랜</span><p className="mt-0.5 text-sm font-black text-white">{selectedPlan.name}</p></div>
              <strong className="text-sm text-neutral-300 md:ml-5">월 {won.format(displayedMonthly)}원</strong>
            </div>
            <Link href={continueHref} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#f04435] px-6 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(240,68,53,.22)] transition hover:bg-[#ff5d4d] md:w-auto md:min-w-64">
              {isAuthenticated ? `${selectedPlan.name} 시작하기` : "로그인하고 시작하기"}
            </Link>
          </footer>
        </section>
      )}
    </div>,
    document.body,
  );
}
