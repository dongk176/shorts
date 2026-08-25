"use client";

import Link from "next/link";
import Script from "next/script";
import { useState } from "react";

export type EnterpriseBillingPaymentPageData = {
  token: string;
  customerName: string;
  title: string;
  status: string;
  expiresAt: string;
  consented: boolean;
  hasRegisteredCard: boolean;
  cardNumberMasked: string | null;
  items: Array<{
    id: string;
    sortOrder: number;
    name: string;
    amountKrw: number;
    status: string;
    paidAt: string | null;
    receiptUrl: string | null;
    serviceStartDate: string;
    serviceEndDate: string;
    includedMinutes: number;
    vatLabel: string;
    paymentDueDate: string;
  }>;
};

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function day(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { detail?: string };
  if (!response.ok && response.status !== 202) {
    throw new Error(payload.detail || "요청을 처리하지 못했습니다.");
  }
  return payload;
}

export function EnterpriseBillingPaymentClient({
  data,
}: {
  data: EnterpriseBillingPaymentPageData;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [purchaseTerms, setPurchaseTerms] = useState(data.consented);
  const [refundPolicy, setRefundPolicy] = useState(data.consented);
  const [storedCardCharge, setStoredCardCharge] = useState(data.consented);
  const [consented, setConsented] = useState(data.consented);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = data.items.reduce((sum, item) => sum + item.amountKrw, 0);
  const paidTotal = data.items
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.amountKrw, 0);
  const current = data.items.find((item) => item.status !== "paid") || null;
  const allAgreed = purchaseTerms && refundPolicy && storedCardCharge;

  async function ensureConsent() {
    if (consented) return;
    if (!allAgreed) throw new Error("세 가지 필수 항목에 모두 동의해 주세요.");
    await post(`/api/enterprise-pay/${encodeURIComponent(data.token)}/consent`, {
      purchaseTermsAgreed: true,
      refundPolicyAgreed: true,
      storedCardChargeAgreed: true,
    });
    setConsented(true);
  }

  async function payCurrent() {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      await ensureConsent();
      if (!data.hasRegisteredCard) {
        if (!sdkReady || !window.TossPayments) {
          throw new Error("카드등록 화면을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        }
        const prepared = await post<{
          clientKey: string;
          customerKey: string;
          successUrl: string;
          failUrl: string;
        }>(
          `/api/enterprise-pay/${encodeURIComponent(data.token)}/billing/registration/prepare`,
          {},
        );
        await window.TossPayments(prepared.clientKey)
          .payment({ customerKey: prepared.customerKey })
          .requestBillingAuth({
            method: "CARD",
            successUrl: prepared.successUrl,
            failUrl: prepared.failUrl,
            customerName: data.customerName,
          });
        return;
      }
      if (!window.confirm(
        `결제하기 버튼을 누르면 등록된 카드로 ${won(current.amountKrw)}이 즉시 결제됩니다. 결제할까요?`,
      )) {
        setBusy(false);
        return;
      }
      const result = await post<{ state: string }>(
        `/api/enterprise-pay/${encodeURIComponent(data.token)}/billing/items/${encodeURIComponent(current.id)}/charge`,
        {},
      );
      if (result.state === "manual_review") {
        setError("결제 결과를 확인하고 있습니다. 다시 결제하지 마세요.");
      } else {
        window.location.reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결제를 진행하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f1213] px-4 py-10 text-neutral-100 sm:px-6 sm:py-16">
      {!data.hasRegisteredCard && current ? (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
          onError={() => setError("카드등록 화면을 불러오지 못했습니다. 새로고침해 주세요.")}
        />
      ) : null}
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 flex items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight text-white">EasyCut</Link>
          <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-neutral-400">
            기업 전용 결제
          </span>
        </header>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#181c1d] shadow-[0_30px_100px_rgba(0,0,0,.38)]">
          <div className="border-b border-white/10 bg-gradient-to-br from-[#ff715e]/15 via-transparent to-sky-400/10 p-6 sm:p-9">
            <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9585]">Enterprise payment</p>
            <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{data.title}</h1>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              {data.customerName} 담당자님, 거래조건을 확인하고 안내된 순서대로 결제해 주세요.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-neutral-500">전체 결제금액</p>
                <p className="mt-1 text-xl font-black">{won(total)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-neutral-500">결제 완료</p>
                <p className="mt-1 text-xl font-black text-emerald-200">{won(paidTotal)}</p>
              </div>
            </div>
            {data.cardNumberMasked ? (
              <p className="mt-4 text-xs text-neutral-400">등록된 카드 {data.cardNumberMasked}</p>
            ) : null}
          </div>

          <div className="grid gap-4 p-5 sm:p-8">
            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[.06] p-5 text-sm leading-7 text-amber-50">
              <p className="font-black">결제 및 이용기간 안내</p>
              <p className="mt-2">모든 결제 상품이 완료되어야 서비스를 이용할 수 있습니다.</p>
              <p>결제가 늦어져도 표시된 계약기간은 자동으로 연장되지 않습니다.</p>
            </div>

            {data.items.map((item) => {
              const isCurrent = current?.id === item.id;
              return (
                <article key={item.id} className={`rounded-2xl border p-5 ${isCurrent ? "border-[#ff715e]/40 bg-[#ff715e]/[.04]" : "border-white/10 bg-black/20"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-neutral-500">결제 순서 {item.sortOrder}</p>
                      <h2 className="mt-1 text-lg font-black">{item.name}</h2>
                    </div>
                    <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-black ${item.status === "paid" ? "bg-emerald-300/10 text-emerald-200" : item.status === "manual_review" || item.status === "confirming" ? "bg-amber-300/10 text-amber-200" : "bg-white/[.06] text-neutral-300"}`}>
                      {item.status === "paid" ? "결제 완료" : item.status === "manual_review" || item.status === "confirming" ? "결제 결과 확인 중" : isCurrent ? "현재 결제" : "이전 결제 후 가능"}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                    <div><dt className="text-xs text-neutral-500">서비스 이용기간</dt><dd className="mt-1 font-bold">{day(item.serviceStartDate)} ~ {day(item.serviceEndDate)}</dd></div>
                    <div><dt className="text-xs text-neutral-500">제공 처리시간</dt><dd className="mt-1 font-bold">{item.includedMinutes.toLocaleString("ko-KR")}분</dd></div>
                    <div><dt className="text-xs text-neutral-500">결제 기한</dt><dd className="mt-1 font-bold">{day(item.paymentDueDate)}</dd></div>
                    <div><dt className="text-xs text-neutral-500">최종 결제금액</dt><dd className="mt-1 text-lg font-black">{won(item.amountKrw)} <span className="text-xs text-neutral-500">({item.vatLabel})</span></dd></div>
                  </dl>
                  {item.status === "paid" ? (
                    <div className="mt-4 flex flex-wrap gap-3 border-t border-white/10 pt-4 text-xs">
                      <span className="text-neutral-500">{item.paidAt ? timestamp(item.paidAt) : "결제 완료"}</span>
                      {item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noreferrer" className="font-black text-sky-200 underline underline-offset-4">영수증 보기</a> : null}
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!consented && current ? (
              <section className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h2 className="text-base font-black">필수 동의</h2>
                <div className="mt-4 grid gap-3 text-sm leading-6 text-neutral-300">
                  <label className="flex items-start gap-3"><input type="checkbox" checked={purchaseTerms} onChange={(event) => setPurchaseTerms(event.target.checked)} className="mt-1 h-4 w-4 accent-[#ff715e]" /><span>[필수] <Link href="/enterprise/purchase-terms/versions/1" target="_blank" className="font-black text-sky-200 underline underline-offset-4">EASYCUT 기업용 서비스 구매 및 이용약관</Link>에 동의합니다.</span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" checked={refundPolicy} onChange={(event) => setRefundPolicy(event.target.checked)} className="mt-1 h-4 w-4 accent-[#ff715e]" /><span>[필수] <Link href="/enterprise/refund-policy/versions/1" target="_blank" className="font-black text-sky-200 underline underline-offset-4">EASYCUT 기업용 취소 및 환불 정책</Link>을 확인하고 동의합니다.</span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" checked={storedCardCharge} onChange={(event) => setStoredCardCharge(event.target.checked)} className="mt-1 h-4 w-4 accent-[#ff715e]" /><span>[필수] 등록된 카드를 이 계정의 결제수단으로 저장하고, 표시된 금액을 확인한 뒤 결제 버튼을 누르면 즉시 결제되는 것에 동의합니다.</span></label>
                </div>
              </section>
            ) : null}

            {current ? (
              <button
                type="button"
                disabled={busy || (!consented && !allAgreed) || current.status !== "pending"}
                onClick={() => void payCurrent()}
                className="min-h-14 rounded-2xl bg-[#ff715e] px-5 text-base font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "처리 중..." : data.hasRegisteredCard
                  ? `등록된 카드로 ${won(current.amountKrw)} 결제하기`
                  : `카드 등록 후 ${won(current.amountKrw)} 결제하기`}
              </button>
            ) : (
              <Link href="/" className="flex min-h-14 items-center justify-center rounded-2xl bg-emerald-300 px-5 text-base font-black text-emerald-950">
                서비스로 이동
              </Link>
            )}
            {error ? <p className="rounded-xl border border-red-300/20 bg-red-300/[.08] px-4 py-3 text-sm leading-6 text-red-100" role="alert">{error}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
