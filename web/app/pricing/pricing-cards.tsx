"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillingCycle, MvpState, PaidPlanCode } from "@/lib/contracts";
import {
  billingPostJson,
  requestAddonPayment,
  requestSubscriptionBillingAuth,
} from "@/lib/billing-client";
import {
  discountedMonthlyPrice,
  estimatedMonthlyShortCount,
  pricingPlans,
  usageAddOns,
  yearlyCharge,
} from "@/lib/pricing";

const won = new Intl.NumberFormat("ko-KR");

const comparisonRows = [
  { label: "원본 영상 처리", values: ["월 100분", "월 200분", "월 600분"] },
  { label: "동시 작업 등록", values: ["1개", "2개", "3개"] },
  { label: "프로젝트 보관", values: ["7일", "15일", "30일"] },
  { label: "템플릿", values: ["전체 4종", "전체 4종", "전체 4종"] },
  { label: "실시간 인기 필터", values: ["연간 결제 시 제공", "연간 결제 시 제공", "연간 결제 시 제공"], accent: true },
  { label: "숏폼 전략 가이드 전자책", values: ["연간 결제 시 제공", "연간 결제 시 제공", "연간 결제 시 제공"], accent: true },
];

function dateText(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function PricingCards() {
  const [yearly, setYearly] = useState(true);
  const [state, setState] = useState<MvpState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/mvp/state", { cache: "no-store" });
    if (!response.ok) throw new Error("구독 상태를 불러오지 못했습니다.");
    setState(await response.json());
  }, []);

  useEffect(() => { void loadState().catch(() => undefined); }, [loadState]);

  const requireLogin = (plan?: PaidPlanCode) => {
    if (state?.user) return false;
    const target = `/pricing${plan ? `?plan=${plan}&cycle=${yearly ? "yearly" : "monthly"}` : ""}`;
    window.location.href = `/auth/sign-in?next=${encodeURIComponent(target)}`;
    return true;
  };

  const choosePlan = async (planCode: PaidPlanCode) => {
    if (requireLogin(planCode)) return;
    const billingCycle: BillingCycle = yearly ? "yearly" : "monthly";
    setBusy(`plan-${planCode}`); setError(null); setMessage(null);
    try {
      if (state?.billing.status === "active") {
        await billingPostJson("/api/billing/subscription/change", { planCode, billingCycle });
        setMessage("다음 결제일부터 새 플랜이 적용됩니다.");
        await loadState();
      } else {
        await requestSubscriptionBillingAuth({ mode: "subscribe", planCode, billingCycle });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "구독 결제를 시작하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const buyAddon = async (code: string) => {
    if (requireLogin()) return;
    if (state?.billing.status !== "active") {
      setError("추가 시간은 활성 구독자만 구매할 수 있습니다.");
      return;
    }
    setBusy(`addon-${code}`); setError(null); setMessage(null);
    try { await requestAddonPayment(code); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "추가 시간 결제를 시작하지 못했습니다."); }
    finally { setBusy(null); }
  };

  const replacePaymentMethod = async () => {
    setBusy("payment-method"); setError(null);
    try { await requestSubscriptionBillingAuth({ mode: "replace_payment_method" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "결제수단 변경을 시작하지 못했습니다."); }
    finally { setBusy(null); }
  };

  const toggleCancellation = async () => {
    if (!state) return;
    setBusy("cancel"); setError(null); setMessage(null);
    try {
      await billingPostJson("/api/billing/subscription/cancel", {
        cancelAtPeriodEnd: !state.billing.cancelAtPeriodEnd,
      });
      setMessage(state.billing.cancelAtPeriodEnd ? "구독 해지 예약을 취소했습니다." : "현재 결제기간 말에 구독이 해지됩니다.");
      await loadState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "구독 해지 상태를 변경하지 못했습니다.");
    } finally { setBusy(null); }
  };

  return (
    <>
      <section className="hero pricing-hero">
        <h1><span>연간 결제 시 20% 할인</span><br /><span className="pricing-hero-accent">실시간 인기 필터 · 전자책 제공</span></h1>
      </section>
      {error && <div role="alert" className="mx-auto mb-6 max-w-2xl rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-center text-sm text-red-100">{error}</div>}
      {message && <div role="status" className="mx-auto mb-6 max-w-2xl rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-center text-sm text-emerald-100">{message}</div>}

      {state && state.billing.status !== "none" && state.billing.status !== "expired" && state.billing.planCode !== "free" && (
        <section className="mx-auto mb-12 max-w-3xl rounded-3xl border border-white/10 bg-[#191c1e]/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,.2)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="text-xs font-black uppercase tracking-[.16em] text-[#ff9b8d]">My subscription</p><h2 className="mt-2 text-2xl font-black text-white">{state.billing.planCode.toUpperCase()} · {state.billing.billingCycle === "yearly" ? "연간" : "월간"}</h2><p className="mt-2 text-sm text-neutral-400">다음 결제일 {dateText(state.billing.nextChargeAt)}</p></div>
            <div className="text-right text-sm text-neutral-300"><strong className="block text-white">기본 {Math.floor(state.usage.baseRemainingSeconds / 60)}분 + 추가 {Math.floor(state.usage.addonRemainingSeconds / 60)}분</strong><span className="mt-1 block text-xs text-neutral-500">예약 중 {Math.ceil(state.usage.reservedSeconds / 60)}분</span></div>
          </div>
          {(state.billing.cardNumberMasked || state.billing.cardLast4) && <p className="mt-5 text-xs text-neutral-500">결제 카드 {state.billing.cardIssuer || "카드"} · {state.billing.cardNumberMasked || `•••• ${state.billing.cardLast4}`}</p>}
          {state.billing.scheduledPlanCode && <p className="mt-3 rounded-xl bg-violet-400/10 p-3 text-xs text-violet-200">{dateText(state.billing.currentPeriodEnd)}부터 {state.billing.scheduledPlanCode.toUpperCase()} 플랜이 적용됩니다.</p>}
          {state.billing.cancelAtPeriodEnd && <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">{dateText(state.billing.currentPeriodEnd)}에 구독이 종료됩니다.</p>}
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={busy !== null} onClick={() => void replacePaymentMethod()} className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-extrabold text-white">결제수단 변경</button><button type="button" disabled={busy !== null} onClick={() => void toggleCancellation()} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-neutral-400">{state.billing.cancelAtPeriodEnd ? "해지 예약 취소" : "기간 말에 해지"}</button></div>
        </section>
      )}

      <div className="pricing-cycle-picker">
        <div className="pricing-toggle" role="group" aria-label="결제 주기">
          <button type="button" onClick={() => setYearly(false)} className={!yearly ? "pricing-toggle-active" : ""}>월간</button>
          <button type="button" className={`pricing-toggle-switch ${yearly ? "pricing-toggle-switch-yearly" : ""}`} aria-label={yearly ? "월간 결제로 변경" : "연간 결제로 변경"} aria-pressed={yearly} onClick={() => setYearly((value) => !value)}><span /></button>
          <button type="button" onClick={() => setYearly(true)} className={yearly ? "pricing-toggle-active" : ""}>연간</button>
        </div>
      </div>
      {!yearly && (
        <div className="pricing-monthly-warning" role="alert">
          <span className="pricing-monthly-warning-icon" aria-hidden="true">!</span>
          <div><strong>월간 결제는 실시간 인기 필터 미제공</strong><p>숏폼 전략 가이드 전자책도 연간 결제에서만 제공됩니다.</p></div>
        </div>
      )}
      <div className="pricing-grid">
        {pricingPlans.map((plan) => {
          const displayedMonthly = yearly ? discountedMonthlyPrice(plan.monthly) : plan.monthly;
          const current = state?.billing.status === "active" && state.billing.planCode === plan.code && state.billing.billingCycle === (yearly ? "yearly" : "monthly") && !state.billing.scheduledPlanCode;
          return (
            <article key={plan.name} className={`pricing-card pricing-card-${plan.code} ${plan.popular ? "pricing-card-popular" : ""}`}>
              {plan.popular && <span className="pricing-badge">가장 인기 있는 플랜</span>}
              {plan.code === "pro" && <span className="pricing-badge pricing-badge-violet">전문가를 위한 플랜</span>}
              <div className="pricing-plan-name"><h2>{plan.name}</h2></div>
              <div className="pricing-price"><strong>{won.format(displayedMonthly)}원</strong><span>/월</span></div>
              <p className="pricing-billing">{yearly ? `연 ${won.format(yearlyCharge(plan.monthly))}원 결제` : "월 단위 자동결제"}</p>
              <ul>
                {yearly ? <>
                  <li className="pricing-yearly-benefit"><span aria-hidden="true">✓</span><strong>실시간 인기 필터 제공</strong></li>
                  <li className="pricing-yearly-benefit"><span aria-hidden="true">✓</span><strong>숏폼 전략 가이드 전자책 제공</strong></li>
                </> : <>
                  <li className="pricing-feature-unavailable"><span aria-hidden="true">!</span><strong>실시간 인기 필터 미제공</strong></li>
                  <li className="pricing-feature-unavailable"><span aria-hidden="true">!</span><strong>숏폼 전략 가이드 전자책 미제공</strong></li>
                </>}
                <li><span aria-hidden="true">✓</span><div><strong className="pricing-usage-emphasis">월 {plan.minutes}분</strong> · 원본 영상 처리</div></li>
                <li><span aria-hidden="true">✓</span><div><strong className="pricing-usage-emphasis">쇼츠 약 {estimatedMonthlyShortCount(plan.minutes)}개</strong> · 10분 영상 기준</div></li>
                {plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}
              </ul>
              <button type="button" disabled={busy !== null || current} onClick={() => void choosePlan(plan.code)} className={plan.popular ? "pricing-cta pricing-cta-primary" : "pricing-cta"}>{current ? "현재 플랜" : busy === `plan-${plan.code}` ? "준비 중..." : state?.billing.status === "active" ? "다음 갱신 때 변경" : `${plan.name} 시작하기`}</button>
            </article>
          );
        })}
      </div>

      <section className="pricing-comparison" aria-labelledby="comparison-heading">
        <div className="pricing-section-heading">
          <h2 id="comparison-heading">플랜 한눈에 보기</h2>
        </div>
        <div className="pricing-comparison-table-wrap">
          <table className="pricing-comparison-table">
            <thead><tr><th>기능</th>{pricingPlans.map((plan) => <th key={plan.code} className={plan.popular ? "pricing-comparison-popular" : ""}>{plan.name}</th>)}</tr></thead>
            <tbody>{comparisonRows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${index}`}>{value}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="pricing-comparison-note">실시간 인기 필터와 숏폼 전략 가이드 전자책은 연간 결제 고객에게만 제공됩니다.</p>
      </section>

      <section className="pricing-addons" aria-labelledby="addon-heading">
        <div className="pricing-section-heading">
          <h2 id="addon-heading">처리 시간이 더 필요할 때</h2>
          <p>구독은 그대로 유지하고 일반결제로 처리시간만 충전하세요.</p>
        </div>
        <div className="pricing-addon-grid">
          {usageAddOns.map((addOn) => (
            <article key={addOn.code} className={`pricing-addon-card ${addOn.badge === "가장 많이 선택" ? "pricing-addon-card-popular" : ""} ${addOn.badge === "분당 최저가" ? "pricing-addon-card-value" : ""}`}>
              {addOn.badge && <span className="pricing-addon-badge">{addOn.badge}</span>}
              <p>추가 {addOn.minutes}분</p>
              <div><strong>{won.format(addOn.price)}원</strong><span>/1회</span></div>
              <button type="button" disabled={busy !== null} onClick={() => void buyAddon(addOn.code)}>{busy === `addon-${addOn.code}` ? "준비 중..." : "추가 시간 구매"}</button>
            </article>
          ))}
        </div>
        <p className="pricing-addon-note">활성 구독자만 구매 가능 · 구매일로부터 90일 유효 · 기본 제공 시간을 먼저 사용</p>
      </section>
    </>
  );
}
