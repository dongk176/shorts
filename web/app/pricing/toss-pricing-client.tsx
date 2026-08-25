"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUsageState } from "@/components/usage-provider";
import type { TossBillingState } from "@/lib/toss-billing-state";
import type { TossCatalogPlan } from "@/lib/toss-subscription";
import styles from "./pricing.module.css";

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
type Selection = {
  plan: TossCatalogPlan;
  action: DialogAction;
};
type ApiError = { detail?: string; message?: string; code?: string };

const TIER_ORDER = { easycut_pro: 0, starter: 1, expert: 2 } as const;
const PACKAGE_TERMS = [3, 6, 12] as const;
type PackageTerm = (typeof PACKAGE_TERMS)[number];

function won(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function billingCycleLabel(contractMonths: TossCatalogPlan["contractMonths"]) {
  if (contractMonths === 1) return "월간 결제";
  if (contractMonths === 3) return "분기 결제";
  if (contractMonths === 6) return "반기 결제";
  return "연간 결제";
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: T & ApiError;
  try {
    payload = (text ? JSON.parse(text) : {}) as T & ApiError;
  } catch {
    throw new Error(response.ok
      ? "결제 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
      : "결제 준비를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "결제 준비를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return payload;
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function features(plan: TossCatalogPlan) {
  const minutes = Math.round(plan.monthlyQuotaSeconds / 60);
  return [
    `매월 ${minutes}분 원본 영상 처리`,
    plan.tier === "easycut_pro"
      ? `쇼츠 매월 약 ${Math.round(minutes * 0.8)}개`
      : `쇼츠 약 ${Math.round(minutes * 0.8 * plan.contractMonths)}개 · ${plan.contractMonths}개월`,
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

function mobileOrderClass(plan: TossCatalogPlan) {
  if (plan.tier === "starter") return styles.mobilePlanStarter;
  if (plan.tier === "expert") return styles.mobilePlanExpert;
  return styles.mobilePlanPro;
}

export function TossPricingClient({
  initialState,
  guestCatalog,
  onRequireLogin,
}: {
  initialState: TossBillingState | null;
  guestCatalog: TossCatalogPlan[] | null;
  onRequireLogin: () => void;
}) {
  const router = useRouter();
  const { refreshUsage } = useUsageState();
  const [state, setState] = useState(initialState);
  const [months, setMonths] = useState<PackageTerm>(6);
  const [sdkReady, setSdkReady] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; detail: string; remainingMinutes?: number } | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/billing/toss/state", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("요금제 정보를 불러오지 못했습니다.");
    setState(await response.json() as TossBillingState);
  }, []);

  useEffect(() => {
    if (initialState || guestCatalog) return;
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "요금제 정보를 불러오지 못했습니다."));
  }, [guestCatalog, initialState, refresh]);

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

  const plans = useMemo(() => (state?.catalog ?? guestCatalog ?? [])
    .filter((plan) => plan.tier === "easycut_pro"
      ? plan.contractMonths === 1
      : plan.contractMonths === months)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]), [guestCatalog, months, state]);
  const loading = !state && !guestCatalog;

  function choose(plan: TossCatalogPlan) {
    if (guestCatalog) {
      onRequireLogin();
      return;
    }
    if (!state) return;
    setError(null);
    setConsent(false);
    if (state.subscription?.scheduledPlan?.code === plan.code) {
      setSelection({ plan, action: "cancel_pending" });
      return;
    }
    if (state.subscription?.plan.code === plan.code) return;
    const quote = state.actions?.find((action) => action.planCode === plan.code);
    const action = !state.subscription
      ? "subscribe"
      : quote?.action === "immediate" ? "immediate" : "scheduled";
    setSelection({ plan, action });
  }

  async function confirm() {
    if (!selection || busy || (selection.action !== "cancel_pending" && !consent)) return;
    setBusy(true);
    setError(null);
    try {
      if (selection.action === "subscribe") {
        if (!sdkReady || !window.TossPayments) {
          throw new Error("결제창을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        }
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
        router.refresh();
        setSelection(null);
        setResult({
          title: "변경 예약이 취소되었습니다",
          detail: "현재 이용 중인 플랜이 그대로 유지됩니다.",
        });
        return;
      }
      const response = await postJson<{ state: string; remainingSeconds?: number; effectiveAt?: string }>(
        "/api/billing/toss/subscription/change",
        { targetPlanCode: selection.plan.code },
      );
      if (response.state === "scheduled") {
        await refresh();
      } else {
        await Promise.all([refresh(), refreshUsage()]);
      }
      router.refresh();
      const selectedName = selection.plan.displayName;
      setSelection(null);
      if (response.state === "scheduled") {
        const effectiveAt = response.effectiveAt ?? state?.subscription?.currentPeriodEnd;
        setResult({
          title: `${selectedName}로 변경 예약되었습니다`,
          detail: effectiveAt
            ? `현재 구독 혜택은 ${date(effectiveAt)}까지 유지됩니다.\n그 다음 결제일부터 새 요금제가 적용됩니다.`
            : "현재 구독 혜택은 계약 기간까지 유지됩니다.\n그 다음 결제일부터 새 요금제가 적용됩니다.",
        });
      } else {
        const remainingMinutes = Math.max(0, Math.floor((response.remainingSeconds ?? 0) / 60));
        setResult({
          title: `${selectedName}로 전환이 완료되었습니다`,
          detail: `남은 사용량 ${remainingMinutes}분`,
          remainingMinutes,
        });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!guestCatalog ? (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          strategy="afterInteractive"
          onReady={() => {
            setSdkReady(true);
            setError(null);
          }}
          onError={() => {
            setSdkReady(false);
            setError("결제창을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
          }}
        />
      ) : null}

      <section className={`hero pricing-hero ${styles.hero}`}>
        <h1><span>필요한 만큼 선택하세요</span></h1>
      </section>

      {error ? <div className={styles.localError} role="alert">{error}</div> : null}

      {state?.subscription?.plan.tier === "easycut_pro"
      && state.subscription.plan.contractMonths !== 1 ? (
        <section className={styles.localLegacyNotice} aria-label="기존 이지컷 프로 계약 안내">
          <strong>이지컷 프로 {state.subscription.plan.contractMonths}개월 기존 계약 이용 중</strong>
          <p>
            기존 계약은 현재 조건과 결제 금액으로 계속 유지됩니다. 월간 이지컷 프로를 선택하면
            {" "}{date(state.subscription.currentPeriodEnd)}부터 월간 계약으로 변경 예약됩니다.
          </p>
        </section>
      ) : null}

      <div className={`${styles.planToolbar} ${styles.localPlanToolbar}`}>
        <span>패키지 이용기간</span>
        <div className={`${styles.packageTermPicker} ${styles.localTermPicker}`} role="group" aria-label="패키지 이용기간">
          {PACKAGE_TERMS.map((term) => (
            <button
              key={term}
              type="button"
              aria-pressed={months === term}
              className={months === term ? styles.packageTermActive : ""}
              onClick={() => setMonths(term)}
            >
              {term}개월
            </button>
          ))}
        </div>
      </div>

      <section
        id="pricing-plans"
        className={`pricing-grid ${styles.localPlanGrid}`}
        aria-label="정기 구독 요금제"
        aria-busy={loading}
      >
        {loading && ["pro", "starter", "expert"].map((plan) => (
          <article
            key={plan}
            className={`pricing-card ${styles.planCard} ${styles.localPlanCard} ${styles.localPlanSkeleton} ${
              plan === "starter"
                ? styles.mobilePlanStarter
                : plan === "expert"
                  ? styles.mobilePlanExpert
                  : styles.mobilePlanPro
            }`}
            aria-hidden="true"
          >
            <span className={styles.localPlanSkeletonName} />
            <strong className={styles.localPlanSkeletonPrice} />
            <i className={styles.localPlanSkeletonBilling} />
            <i className={styles.localPlanSkeletonDescription} />
            <div className={styles.localPlanSkeletonFeatures}><i /><i /><i /><i /><i /><i /></div>
            <span className={styles.localPlanSkeletonButton} />
          </article>
        ))}

        {plans.map((plan) => {
          const current = state?.subscription?.plan.code === plan.code;
          const pending = state?.subscription?.scheduledPlan?.code === plan.code;
          const cardClass = plan.tier === "starter"
            ? "pricing-card-popular"
            : plan.tier === "expert" ? "pricing-card-pro" : "";
          return (
            <article
              key={plan.code}
              className={`pricing-card ${cardClass} ${styles.planCard} ${styles.localPlanCard} ${styles.packagePlanCard} ${mobileOrderClass(plan)}`}
            >
              {plan.tier === "starter" && plan.contractMonths === 6 ? (
                <span className={`pricing-badge ${styles.localReasonableBadge}`}>가장 합리적</span>
              ) : null}
              {plan.tier === "starter" && plan.contractMonths === 12 ? (
                <span className={`pricing-badge ${styles.localReasonableBadge}`}>최대 할인</span>
              ) : null}
              {plan.discountPercent > 0 ? (
                <span className={`${styles.planEyebrow} ${styles.discountEyebrow} ${
                  plan.tier === "expert" ? styles.discountEyebrowViolet : ""
                }`}>
                  {plan.discountPercent}% 할인
                </span>
              ) : null}
              <div className="pricing-plan-name"><h2>{plan.displayName}</h2></div>
              <p className={styles.localPlanDescription}>{subtitle(plan)}</p>
              <div className={`pricing-price ${styles.localPlanPrice}`}>
                <strong>₩{won(plan.monthlyEquivalentKrw)}</strong><span>/월</span>
              </div>
              <p className="pricing-billing">
                {plan.tier === "easycut_pro"
                  ? billingCycleLabel(plan.contractMonths)
                  : `${billingCycleLabel(plan.contractMonths)} · 총 ₩${won(plan.priceKrw)}`}
              </p>
              <ul>
                {features(plan).map((feature, index) => (
                  <li key={feature} className={index === 5 && !plan.guidebookIncluded ? "pricing-feature-unavailable" : ""}>
                    <span>{index === 5 && !plan.guidebookIncluded ? "–" : "✓"}</span>
                    <span>{index === 0 ? <strong>{feature.replace(" 원본 영상 처리", "")}</strong> : feature}{index === 0 ? " 원본 영상 처리" : ""}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || current}
                className={`pricing-cta ${plan.tier === "starter" ? "pricing-cta-primary" : ""} ${styles.planCta} ${pending ? styles.planCtaPending : ""}`}
                onClick={() => choose(plan)}
              >
                {current
                  ? "이용 중"
                  : pending ? (
                    <span className={styles.planCtaPendingContent}>
                      <span className={styles.planCtaPendingIndicator} aria-hidden="true" />
                      <span className={styles.planCtaPendingCopy}><strong>이 플랜으로 변경 예약됨</strong></span>
                    </span>
                  ) : state?.subscription
                    ? `${plan.displayName}로 전환하기`
                    : `${plan.displayName} 구독 시작하기`}
              </button>
            </article>
          );
        })}
      </section>

      {selection && state ? (
        <div className={styles.localDialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setSelection(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title" className={styles.localDialog}>
            <div className={styles.localDialogHeader}>
              <h2 id="plan-dialog-title">
                {selection.action === "cancel_pending"
                  ? "변경 예약 취소하기"
                  : selection.action === "subscribe"
                    ? "구독 시작 확인하기"
                    : "플랜 전환 확인하기"}
              </h2>
              <button type="button" aria-label="닫기" disabled={busy} onClick={() => setSelection(null)}>×</button>
            </div>
            <div className={styles.localDialogBody}>
              {selection.action === "cancel_pending" ? (
                <div className={styles.localPlanSummary}>
                  <div className={styles.localPlanSummaryCopy}>
                    <strong>{selection.plan.displayName} {selection.plan.contractMonths}개월</strong>
                    <span>예약을 취소하면 현재 플랜이 그대로 유지됩니다.</span>
                  </div>
                </div>
              ) : (
                <div className={styles.localPlanSummary}>
                  <div className={styles.localPlanSummaryCopy}>
                    <strong>{selection.plan.displayName}</strong>
                    {selection.action === "scheduled" && state.subscription ? (
                      <span>현재 구독 종료 후 적용됩니다</span>
                    ) : null}
                    <ul className={styles.localPlanSummaryFeatures}>
                      {features(selection.plan).slice(0, 5).map((feature, index) => (
                        <li key={feature}>
                          <span>✓</span>
                          <span>{index === 0
                            ? <><strong>{feature.replace(" 원본 영상 처리", "")}</strong> 원본 영상 처리</>
                            : feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {selection.action === "subscribe" && !state.paymentRestrictions.hanaCardAvailable ? (
                <aside className={styles.localCardRestriction} aria-label="결제 가능 카드 안내">
                  <strong>하나카드는 아직 결제할 수 없어요</strong>
                  <p>카드사 심사 중으로 현재 하나카드는 등록과 결제가 완료되지 않습니다. 토스 결제창에서 다른 카드를 선택해 주세요.</p>
                </aside>
              ) : null}
              {selection.action !== "cancel_pending" ? (
                <label className={styles.localConsent}>
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>
                    <Link href="/purchase-terms" target="_blank">구매약관</Link> 및{" "}
                    <Link href="/refund" target="_blank">취소·환불 정책</Link>에 동의합니다.
                  </span>
                </label>
              ) : null}
              {error ? <div className={styles.localError} role="alert">{error}</div> : null}
            </div>
            <div className={styles.localDialogActions}>
              <button type="button" disabled={busy} onClick={() => setSelection(null)}>취소</button>
              <button
                type="button"
                disabled={busy || (selection.action !== "cancel_pending" && !consent)}
                onClick={() => void confirm()}
              >
                {busy
                  ? "처리 중..."
                  : selection.action === "cancel_pending"
                    ? "예약 취소"
                    : selection.action === "subscribe"
                      ? "시작하기"
                      : selection.action === "scheduled"
                        ? "변경 예약"
                        : "전환 확인"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {result ? (
        <div className={styles.localDialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResult(null);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-result-title"
            className={`${styles.localDialog} ${styles.localResultDialog}`}
          >
            <h2 id="plan-result-title">{result.title}</h2>
            {typeof result.remainingMinutes === "number" ? (
              <p className={styles.localResultUsage}>
                남은 사용량 <strong>{won(result.remainingMinutes)}분</strong>
              </p>
            ) : (
              <p className={styles.localResultSchedule}>
                {result.detail.split("\n").map((line) => <span key={line}>{line}</span>)}
              </p>
            )}
            <button type="button" className={styles.localResultConfirm} onClick={() => setResult(null)}>확인</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
