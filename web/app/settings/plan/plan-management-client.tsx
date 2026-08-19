"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { BillingSummary } from "@/lib/contracts";
import type { AuthProfile } from "@/lib/session";
import type { TossBillingState } from "@/lib/toss-billing-state";

type ConfirmAction = "cancel" | "resume" | null;

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
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
  const [result, setResult] = useState<string | null>(null);

  const legacyProduct = legacyState?.activeProducts.find((product) =>
    product.planCode === "easycut_pro_v2" && product.billingCycle === "monthly"
  ) ?? null;
  const canceled = provider === "toss"
    ? Boolean(tossState?.subscription?.cancelAtPeriodEnd)
    : Boolean(legacyProduct?.cancelAtPeriodEnd);

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
    if (!confirm || busy) return;
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
      setResult(cancelAtPeriodEnd ? "구독 해지가 예약되었습니다" : "구독이 다시 활성화되었습니다");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const title = provider === "toss"
    ? tossState?.subscription?.plan.displayName ?? "이용 중인 구독이 없습니다"
    : legacyProduct?.displayName ?? "이용 중인 구독이 없습니다";
  const periodEnd = provider === "toss" ? tossState?.subscription?.currentPeriodEnd : null;
  const card = provider === "toss" ? tossState?.subscription?.paymentMethod : null;

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <SiteHeader desktopSidebar><AuthControls user={user} next="/settings/plan" /></SiteHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <Link href="/settings" className="text-sm font-bold text-neutral-500 transition hover:text-white">← 설정</Link>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white">요금제 관리</h1>
        <p className="mt-3 text-sm leading-7 text-neutral-400">이용 중인 플랜과 자동결제 상태를 관리할 수 있습니다.</p>

        <section className="mt-9 rounded-[26px] border border-white/10 bg-[#191c1e]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,.22)] sm:p-8">
          <span className="text-xs font-black tracking-[.16em] text-[#ff8c7c]">현재 요금제</span>
          <h2 className="mt-3 text-3xl font-black text-white">{title}</h2>
          {periodEnd ? <p className="mt-3 text-sm text-neutral-400">{date(periodEnd)}까지 이용</p> : null}
          {card?.cardNumberMasked || card?.cardLast4 ? (
            <p className="mt-2 text-xs text-neutral-500">등록 카드 {card.cardNumberMasked || `•••• ${card.cardLast4}`}</p>
          ) : null}
          {canceled && periodEnd ? (
            <p className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/[.055] px-4 py-3 text-sm leading-6 text-amber-100/80">
              {date(periodEnd)}에 구독이 종료될 예정입니다.
            </p>
          ) : null}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/pricing" className="grid min-h-12 flex-1 place-items-center rounded-xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] text-sm font-black text-white">요금제 변경</Link>
            {(provider === "toss" ? tossState?.subscription : legacyProduct) && !(provider === "thepayone" && canceled) ? (
              <button
                type="button"
                onClick={() => setConfirm(canceled ? "resume" : "cancel")}
                className="min-h-12 flex-1 rounded-xl border border-white/12 px-5 text-sm font-black text-neutral-200 transition hover:bg-white/[.05]"
              >
                {canceled ? "구독 계속 이용" : "구독 해지"}
              </button>
            ) : null}
          </div>
        </section>
      </main>
      <SiteFooter />

      {confirm ? (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/60 p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirm(null);
        }}>
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[22px] border border-white/15 bg-[#232526] p-6 shadow-[0_30px_100px_rgba(0,0,0,.65)]">
            <h2 className="text-xl font-black text-white">{confirm === "cancel" ? "구독을 해지할까요?" : "구독을 계속 이용할까요?"}</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-400">
              {confirm === "cancel"
                ? "현재 결제기간이 끝날 때까지는 모든 혜택을 그대로 이용할 수 있습니다."
                : "예약된 해지가 취소되고 기존 자동결제가 유지됩니다."}
            </p>
            {error ? <p role="alert" className="mt-4 text-sm text-red-200">{error}</p> : null}
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="min-h-11 rounded-xl border border-white/12 px-5 text-sm font-black">취소</button>
              <button type="button" disabled={busy} onClick={() => void mutate()} className="min-h-11 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white disabled:opacity-40">{busy ? "처리 중" : "확인"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {result ? (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/60 p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResult(null);
        }}>
          <section role="status" className="w-full max-w-md rounded-[22px] border border-white/15 bg-[#232526] p-6 shadow-[0_30px_100px_rgba(0,0,0,.65)]">
            <h2 className="text-xl font-black text-white">{result}</h2>
            <button type="button" onClick={() => setResult(null)} className="mt-7 min-h-11 w-full rounded-xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] px-5 text-sm font-black text-white">확인</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
