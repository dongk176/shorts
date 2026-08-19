"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TossBillingState } from "@/lib/toss-billing-state";
import type { TossCatalogPlan, TossContractMonths } from "@/lib/toss-subscription";
import styles from "./toss-pricing.module.css";

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      payment: (input: { customerKey: string }) => {
        requestBillingAuth: (input: {
          method: "CARD";
          successUrl: string;
          failUrl: string;
          customerName: string;
        }) => Promise<void>;
      };
    };
  }
}

type DialogAction = "subscribe" | "immediate" | "scheduled" | "cancel_pending";
type Selection = { plan: TossCatalogPlan; action: DialogAction };
type ApiError = { detail?: string };

const TIER_ORDER = { easycut_pro: 0, starter: 1, expert: 2 } as const;

function won(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(payload.detail || "요청을 완료하지 못했습니다.");
  return payload;
}

function features(plan: TossCatalogPlan) {
  const minutes = Math.round(plan.monthlyQuotaSeconds / 60);
  return [
    `매월 ${minutes}분 원본 영상 처리`,
    `쇼츠 약 ${Math.round(minutes * 0.8 * plan.contractMonths)}개 · ${plan.contractMonths}개월`,
    `동시 작업 ${plan.maxActiveJobs}개`,
    "프로젝트 30일 보관",
    "실시간 인기 필터 제공",
    plan.guidebookIncluded ? "숏폼 전략 가이드 PDF 다운로드" : "숏폼 전략 가이드 PDF 미제공",
  ];
}

function subtitle(plan: TossCatalogPlan) {
  if (plan.tier === "easycut_pro") return "핵심 기능을 가볍게 시작하는 플랜";
  if (plan.tier === "starter") return "꾸준한 제작을 위한 넉넉한 플랜";
  return "대량 제작과 운영을 위한 최대 플랜";
}

export function TossPricingClient({ initialState }: { initialState: TossBillingState | null }) {
  const [state, setState] = useState(initialState);
  const [months, setMonths] = useState<TossContractMonths>(6);
  const [sdkReady, setSdkReady] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; detail: string } | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/billing/toss/state", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("요금제 정보를 불러오지 못했습니다.");
    setState(await response.json() as TossBillingState);
  }, []);

  useEffect(() => {
    if (initialState) return;
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "요금제 정보를 불러오지 못했습니다."));
  }, [initialState, refresh]);

  useEffect(() => {
    if (!selection && !result) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setSelection(null);
        setResult(null);
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previous;
    };
  }, [busy, result, selection]);

  const plans = useMemo(() => (state?.catalog ?? [])
    .filter((plan) => plan.contractMonths === months)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]), [months, state]);

  function choose(plan: TossCatalogPlan) {
    if (!state) return;
    if (state.subscription?.scheduledPlan?.code === plan.code) {
      setConsent(false);
      setSelection({ plan, action: "cancel_pending" });
      return;
    }
    if (state.subscription?.plan.code === plan.code) return;
    const quoted = state.actions?.find((action) => action.planCode === plan.code)?.action;
    setConsent(false);
    setSelection({
      plan,
      action: !state.subscription ? "subscribe" : quoted === "immediate" ? "immediate" : "scheduled",
    });
  }

  async function confirm() {
    if (!selection || busy || (selection.action !== "cancel_pending" && !consent)) return;
    setBusy(true);
    setError(null);
    try {
      if (selection.action === "subscribe") {
        if (!sdkReady || !window.TossPayments) throw new Error("결제창을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        const prepared = await postJson<{
          clientKey: string;
          customerKey: string;
          successUrl: string;
          failUrl: string;
        }>("/api/billing/toss/checkout/prepare", { targetPlanCode: selection.plan.code });
        await window.TossPayments(prepared.clientKey).payment({ customerKey: prepared.customerKey }).requestBillingAuth({
          method: "CARD",
          successUrl: prepared.successUrl,
          failUrl: prepared.failUrl,
          customerName: "이지컷",
        });
        return;
      }
      if (selection.action === "cancel_pending") {
        await postJson("/api/billing/toss/subscription/change/cancel", {});
        await refresh();
        setSelection(null);
        setResult({ title: "변경 예약이 취소되었습니다", detail: "현재 이용 중인 플랜이 그대로 유지됩니다." });
        return;
      }
      const response = await postJson<{ state: string; remainingSeconds?: number }>(
        "/api/billing/toss/subscription/change",
        { targetPlanCode: selection.plan.code },
      );
      await refresh();
      const selectedName = selection.plan.displayName;
      setSelection(null);
      if (response.state === "scheduled") {
        setResult({
          title: `${selectedName}로 변경 예약되었습니다`,
          detail: "현재 구독 혜택은 계약 기간까지 유지됩니다.\n그 다음 결제일부터 새 요금제가 적용됩니다.",
        });
      } else {
        const remaining = Math.max(0, Math.floor((response.remainingSeconds ?? 0) / 60));
        setResult({ title: `${selectedName}로 전환이 완료되었습니다`, detail: `남은 사용량 ${remaining}분` });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className={styles.loading} aria-busy="true">
        <div className={styles.loadingTitle} />
        <div className={styles.loadingCards}><i /><i /><i /></div>
        {error ? <p role="alert" className={styles.pageError}>{error}</p> : null}
      </section>
    );
  }

  return (
    <>
      <Script src="https://js.tosspayments.com/v2/standard" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
      <section className={styles.root}>
        <header className={styles.hero}>
          <h1>필요한 만큼 선택하세요</h1>
          <div className={styles.termRow}>
            <span>이용 기간</span>
            <div className={styles.termPicker} role="group" aria-label="이용 기간">
              {([1, 6, 12] as const).map((term) => (
                <button key={term} type="button" aria-pressed={months === term} onClick={() => setMonths(term)}>
                  {term}개월
                </button>
              ))}
            </div>
          </div>
        </header>

        {error ? <p role="alert" className={styles.pageError}>{error}</p> : null}

        <div className={styles.cards}>
          {plans.map((plan) => {
            const current = state.subscription?.plan.code === plan.code;
            const pending = state.subscription?.scheduledPlan?.code === plan.code;
            const action = state.actions?.find((item) => item.planCode === plan.code)?.action;
            return (
              <article key={plan.code} className={`${styles.card} ${styles[plan.tier]} ${pending ? styles.pending : ""}`}>
                {plan.tier === "starter" ? <strong className={styles.recommended}>가장 합리적</strong> : null}
                <h2>{plan.displayName}</h2>
                <p className={styles.subtitle}>{subtitle(plan)}</p>
                <div className={styles.price}><b>₩{won(plan.monthlyEquivalentKrw)}</b><span>/월</span></div>
                <div className={styles.discountLine}>
                  <span>{plan.contractMonths}개월 이용</span>
                  {plan.discountPercent ? <strong>{plan.discountPercent}% 할인</strong> : <strong>기본 요금</strong>}
                </div>
                <ul>
                  {features(plan).map((feature, index) => (
                    <li key={feature} className={index === 5 && !plan.guidebookIncluded ? styles.muted : ""}>
                      <span aria-hidden="true">{index === 5 && !plan.guidebookIncluded ? "–" : "✓"}</span>{feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`${styles.selectButton} ${pending ? styles.pendingButton : ""}`}
                  disabled={current || busy}
                  onClick={() => choose(plan)}
                >
                  {current ? "이용 중" : pending ? "이 플랜으로 변경 예약됨" : `${plan.displayName}로 전환하기`}
                </button>
                {action === "scheduled" && !pending && !current ? <p className={styles.cardHint}>다음 결제일부터 적용됩니다.</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      {selection ? (
        <div className={styles.overlay} onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setSelection(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title" className={styles.dialog}>
            <button type="button" aria-label="닫기" className={styles.close} onClick={() => setSelection(null)}>×</button>
            <h2 id="plan-dialog-title">{selection.action === "cancel_pending" ? "변경 예약을 취소할까요?" : "플랜 전환 확인하기"}</h2>
            <p>
              {selection.action === "cancel_pending"
                ? `${selection.plan.displayName} 변경 예약을 취소하고 현재 플랜을 유지합니다.`
                : selection.action === "scheduled" && state.subscription
                  ? `현재 구독 혜택은 ${date(state.subscription.currentPeriodEnd)}까지 유지됩니다.\n그 다음 결제일부터 ${selection.plan.displayName} 플랜이 적용됩니다.`
                  : `${selection.plan.displayName} 플랜으로 전환할까요?`}
            </p>
            <div className={styles.planSummary}>
              <strong>{selection.plan.displayName}</strong>
              <span>매월 {Math.round(selection.plan.monthlyQuotaSeconds / 60)}분</span>
            </div>
            {selection.action !== "cancel_pending" ? (
              <label className={styles.consent}>
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span><a href="/purchase-terms" target="_blank">구매약관</a> 및 <a href="/refund" target="_blank">취소·환불 정책</a>에 동의합니다.</span>
              </label>
            ) : null}
            {error ? <p role="alert" className={styles.dialogError}>{error}</p> : null}
            <footer>
              <button type="button" onClick={() => setSelection(null)} disabled={busy}>취소</button>
              <button type="button" className={styles.primary} onClick={() => void confirm()} disabled={busy || (selection.action !== "cancel_pending" && !consent)}>
                {busy ? "처리 중" : selection.action === "cancel_pending" ? "예약 취소" : "전환 확인"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {result ? (
        <div className={styles.overlay} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResult(null);
        }}>
          <section role="status" aria-live="polite" className={styles.dialog}>
            <button type="button" aria-label="닫기" className={styles.close} onClick={() => setResult(null)}>×</button>
            <h2>{result.title}</h2>
            <p className={styles.resultDetail}>{result.detail}</p>
            <footer><button type="button" className={styles.primary} onClick={() => setResult(null)}>확인</button></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
