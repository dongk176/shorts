"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { BillingSummary } from "@/lib/contracts";
import type { AuthProfile } from "@/lib/session";
import type { TossBillingState } from "@/lib/toss-billing-state";
import {
  thePayOnePlanManagementView,
  tossPlanManagementView,
  type ManagedPlan,
} from "./plan-management-model";

type ConfirmAction = "cancel" | "resume" | null;
type Result = { title: string; detail: string } | null;

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

async function post(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) throw new Error(payload.detail || "요청을 완료하지 못했습니다.");
}

function planScheduleCopy(plan: ManagedPlan, hasNextPlan: boolean) {
  if (plan.cancelAtPeriodEnd) return `${date(plan.periodEnd)} 이용 종료 예정`;
  if (hasNextPlan) return `${date(plan.periodEnd)}까지 현재 혜택`;
  if (plan.kind === "subscription" && plan.nextChargeAt) {
    return `${date(plan.nextChargeAt)} 다음 갱신`;
  }
  return `${date(plan.periodEnd)}까지 이용`;
}

function PlanCard({ plan, hasNextPlan }: { plan: ManagedPlan; hasNextPlan: boolean }) {
  return (
    <article className="rounded-[24px] border border-white/[.09] bg-[#191c1e]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,.2)] sm:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black ${
          plan.cancelAtPeriodEnd
            ? "border-amber-300/20 bg-amber-300/[.07] text-amber-100/80"
            : "border-emerald-300/15 bg-emerald-300/[.06] text-emerald-100/80"
        }`}>
          <i className={`h-1.5 w-1.5 rounded-full ${plan.cancelAtPeriodEnd ? "bg-amber-300" : "bg-emerald-300"}`} aria-hidden="true" />
          {plan.cancelAtPeriodEnd ? "해지 예정" : "이용 중"}
        </span>
        {plan.termLabel ? (
          <span className="rounded-full border border-white/[.08] px-3 py-1 text-[11px] font-bold text-neutral-500">
            {plan.termLabel}
          </span>
        ) : null}
      </div>

      <h2 className="mt-5 text-3xl font-black tracking-tight text-white">{plan.name}</h2>
      <div className="mt-5 flex flex-wrap gap-2">
        <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
          매월 {plan.monthlyMinutes.toLocaleString("ko-KR")}분
        </span>
        {plan.maxActiveJobs ? (
          <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
            동시 작업 {plan.maxActiveJobs}개
          </span>
        ) : null}
        {plan.guidebookIncluded !== null ? (
          <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
            가이드북 {plan.guidebookIncluded ? "포함" : "미포함"}
          </span>
        ) : null}
      </div>

      <div className="mt-6 border-t border-white/[.07] pt-5">
        <p className={`text-sm font-bold ${plan.cancelAtPeriodEnd ? "text-amber-100/75" : "text-neutral-300"}`}>
          {planScheduleCopy(plan, hasNextPlan)}
        </p>
        {plan.nextQuotaAt && plan.nextQuotaAt !== plan.periodEnd ? (
          <p className="mt-2 text-xs text-neutral-500">다음 처리시간 지급 {date(plan.nextQuotaAt)}</p>
        ) : null}
      </div>
    </article>
  );
}

export function PlanManagementClient({ user, provider, initialTossState, initialLegacyState }: {
  user: AuthProfile;
  provider: "toss" | "thepayone";
  initialTossState: TossBillingState | null;
  initialLegacyState: BillingSummary | null;
}) {
  const [tossState, setTossState] = useState(initialTossState);
  const [legacyState, setLegacyState] = useState(initialLegacyState);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);

  const view = provider === "toss"
    ? tossPlanManagementView(tossState)
    : thePayOnePlanManagementView(legacyState);
  const cancellablePlan = view.plans.find((plan) => plan.canCancel) ?? null;
  const canceledPlan = view.plans.find((plan) => plan.kind === "subscription" && plan.cancelAtPeriodEnd) ?? null;
  const managedPlan = cancellablePlan ?? canceledPlan ?? view.plans.find((plan) => plan.kind === "subscription") ?? null;

  async function refresh() {
    if (provider === "toss") {
      const response = await fetch("/api/billing/toss/state", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("구독 정보를 불러오지 못했습니다.");
      setTossState(await response.json() as TossBillingState);
      return;
    }
    const response = await fetch("/api/mvp/state", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("구독 정보를 불러오지 못했습니다.");
    const state = await response.json() as { billing: BillingSummary };
    setLegacyState(state.billing);
  }

  async function mutate() {
    if (!confirm || busy || !managedPlan) return;
    setBusy(true);
    setError(null);
    try {
      const cancelAtPeriodEnd = confirm === "cancel";
      await post(
        provider === "toss" ? "/api/billing/toss/subscription/cancel" : "/api/billing/subscription/cancel",
        { cancelAtPeriodEnd },
      );
      await refresh();
      setConfirm(null);
      setResult(cancelAtPeriodEnd
        ? {
            title: "구독 해지가 예약되었습니다",
            detail: `${date(managedPlan.periodEnd)}까지 현재 플랜을 그대로 이용할 수 있습니다.`,
          }
        : {
            title: "구독을 계속 이용합니다",
            detail: "예약된 해지가 취소되고 현재 플랜이 유지됩니다.",
          });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <SiteHeader desktopSidebar><AuthControls user={user} next="/settings/plan" /></SiteHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <Link href="/settings" className="text-sm font-bold text-neutral-500 transition hover:text-white">← 설정</Link>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white">요금제 관리</h1>
        <p className="mt-3 text-sm leading-7 text-neutral-400">지금 이용할 수 있는 기능과 다음 변경 일정을 확인할 수 있습니다.</p>

        {view.plans.length > 0 ? (
          <section className="mt-9 !border-0 !bg-transparent !p-0 !shadow-none !backdrop-blur-none" aria-labelledby="active-plans-title">
            <h2 id="active-plans-title" className="mb-3 text-xs font-black tracking-[.16em] text-neutral-500">
              이용 중인 플랜
            </h2>
            <div className="grid gap-4">
              {view.plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  hasNextPlan={Boolean(
                    view.nextPlan
                    && plan.kind === "subscription"
                    && plan.periodEnd === view.nextPlan.effectiveAt
                  )}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-9 rounded-[24px] border border-white/[.09] bg-[#191c1e]/90 p-7 sm:p-8">
            <span className="text-xs font-black tracking-[.14em] text-neutral-500">이용 중인 플랜</span>
            <h2 className="mt-4 text-2xl font-black text-white">현재 이용 중인 유료 플랜이 없습니다</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-400">필요한 처리시간과 작업 방식에 맞는 플랜을 살펴보세요.</p>
            <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-white/[.07] px-5 text-sm font-black text-white transition hover:bg-white/[.11]">
              요금제 살펴보기
            </Link>
          </section>
        )}

        {view.nextPlan ? (
          <section className="relative mt-5 overflow-hidden rounded-[24px] border border-[#a78bfa]/20 bg-[#1c1c24] p-6 sm:p-8" aria-labelledby="next-plan-title">
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#ff715e] to-[#8b5cf6]" aria-hidden="true" />
            <span className="text-xs font-black tracking-[.16em] text-[#b9a5ff]">다음 플랜</span>
            <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="next-plan-title" className="text-2xl font-black text-white">{view.nextPlan.name}</h2>
                  {view.nextPlan.termLabel ? (
                    <span className="rounded-full border border-white/[.1] px-3 py-1 text-[11px] font-bold text-neutral-400">
                      {view.nextPlan.termLabel}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-bold text-neutral-300">{date(view.nextPlan.effectiveAt)}부터 전환 예정</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
                    매월 {view.nextPlan.monthlyMinutes.toLocaleString("ko-KR")}분
                  </span>
                  {view.nextPlan.maxActiveJobs ? (
                    <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
                      동시 작업 {view.nextPlan.maxActiveJobs}개
                    </span>
                  ) : null}
                  {view.nextPlan.guidebookIncluded !== null ? (
                    <span className="rounded-xl bg-white/[.055] px-3 py-2 text-xs font-bold text-neutral-300">
                      가이드북 {view.nextPlan.guidebookIncluded ? "포함" : "미포함"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 text-xs leading-6 text-neutral-500">등록 카드 승인 후 새 플랜이 시작됩니다.</p>
              </div>
              <Link href="/pricing" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-white/[.12] px-5 text-sm font-black text-neutral-200 transition hover:bg-white/[.06]">
                변경 예약 관리
              </Link>
            </div>
          </section>
        ) : null}

        {(view.plans.length > 0 || view.paymentMethod) ? (
          <details className="group mt-5 overflow-hidden rounded-[22px] border border-white/[.08] bg-[#171a1b]/75">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 transition hover:bg-white/[.025] [&::-webkit-details-marker]:hidden">
              <span>
                <strong className="block text-sm font-black text-neutral-200">결제 및 구독 설정</strong>
                <span className="mt-1 block text-xs text-neutral-500">등록 카드와 구독 상태를 관리합니다.</span>
              </span>
              <span className="text-lg text-neutral-600 transition group-open:rotate-180" aria-hidden="true">⌄</span>
            </summary>
            <div className="border-t border-white/[.07] px-5 py-5">
              {view.paymentMethod ? (
                <div className="flex items-center gap-3 rounded-2xl bg-black/15 p-4">
                  <span className="grid h-10 w-12 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-[#101315] text-neutral-400" aria-hidden="true">▰</span>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-black text-neutral-200">
                      {view.paymentMethod.issuer || "등록 카드"}
                      {view.paymentMethod.cardLabel ? ` · ${view.paymentMethod.cardLabel}` : ""}
                    </strong>
                    <span className="mt-1 block text-xs text-neutral-600">{view.paymentMethod.providerLabel}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-neutral-500">등록된 결제 수단을 표시할 수 없습니다.</p>
              )}

              {managedPlan ? (
                <div className="mt-5 flex flex-col gap-3 border-t border-white/[.07] pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <strong className="text-sm font-black text-neutral-300">{managedPlan.name} 구독</strong>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      {managedPlan.cancelAtPeriodEnd
                        ? `${date(managedPlan.periodEnd)}에 이용이 종료될 예정입니다.`
                        : "해지해도 현재 이용기간까지 혜택은 유지됩니다."}
                    </p>
                  </div>
                  {cancellablePlan ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirm("cancel");
                      }}
                      className="min-h-10 shrink-0 rounded-xl border border-white/[.1] px-4 text-xs font-black text-neutral-400 transition hover:border-red-300/25 hover:bg-red-300/[.04] hover:text-red-100"
                    >
                      구독 해지
                    </button>
                  ) : view.canResume ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirm("resume");
                      }}
                      className="min-h-10 shrink-0 rounded-xl border border-white/[.1] px-4 text-xs font-black text-neutral-300 transition hover:bg-white/[.05]"
                    >
                      구독 계속 이용
                    </button>
                  ) : null}
                </div>
              ) : null}

              <Link href="/pricing" className="mt-5 inline-flex text-xs font-black text-neutral-500 underline decoration-white/10 underline-offset-4 transition hover:text-neutral-200">
                다른 요금제 살펴보기
              </Link>
            </div>
          </details>
        ) : null}
      </main>
      <SiteFooter />

      {confirm && managedPlan ? (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/65 p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirm(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title" className="w-full max-w-md rounded-[22px] border border-white/[.14] bg-[#232526] p-6 shadow-[0_30px_100px_rgba(0,0,0,.65)]">
            <h2 id="subscription-dialog-title" className="text-xl font-black text-white">
              {confirm === "cancel" ? `${managedPlan.name} 구독을 해지할까요?` : "구독을 계속 이용할까요?"}
            </h2>
            <p className="mt-3 text-sm leading-7 text-neutral-400">
              {confirm === "cancel"
                ? `${date(managedPlan.periodEnd)}까지 현재 플랜의 기능을 그대로 이용할 수 있습니다. 이후 자동 갱신이 중지됩니다.`
                : "예약된 해지가 취소되고 현재 플랜의 자동 갱신이 유지됩니다."}
            </p>
            {confirm === "cancel" && provider === "toss" && view.nextPlan ? (
              <p className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[.055] px-4 py-3 text-sm leading-6 text-amber-100/80">
                구독을 해지하면 {view.nextPlan.name} 변경 예약도 함께 취소됩니다.
              </p>
            ) : null}
            {error ? <p role="alert" className="mt-4 text-sm text-red-200">{error}</p> : null}
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="min-h-11 rounded-xl border border-white/[.12] px-5 text-sm font-black">닫기</button>
              <button type="button" disabled={busy} onClick={() => void mutate()} className="min-h-11 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white disabled:opacity-40">
                {busy ? "처리 중" : confirm === "cancel" ? "해지 예약" : "계속 이용"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {result ? (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/65 p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResult(null);
        }}>
          <section role="status" className="w-full max-w-md rounded-[22px] border border-white/[.14] bg-[#232526] p-6 shadow-[0_30px_100px_rgba(0,0,0,.65)]">
            <h2 className="text-xl font-black text-white">{result.title}</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-400">{result.detail}</p>
            <button type="button" onClick={() => setResult(null)} className="mt-7 min-h-11 w-full rounded-xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] px-5 text-sm font-black text-white">확인</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
