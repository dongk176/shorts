"use client";

import Script from "next/script";
import { useState } from "react";

export type EnterprisePaymentPageData = {
  token: string;
  customerName: string;
  customerEmail: string | null;
  title: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    amountKrw: number;
    status: string;
    paidAt: string | null;
    receiptUrl: string | null;
  }>;
};

type PrepareResponse = {
  clientKey: string;
  attemptId: string;
  orderId: string;
  orderName: string;
  amount: number;
  customerName: string;
  customerEmail?: string;
  successUrl: string;
  failUrl: string;
  detail?: string;
};

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function requestStatus(status: string) {
  if (status === "paid") return "모든 결제가 완료되었습니다";
  if (status === "partial") return "일부 결제가 완료되었습니다";
  if (status === "expired") return "결제 기한이 만료되었습니다";
  if (status === "canceled") return "취소된 결제 요청입니다";
  return "결제 요청을 확인해 주세요";
}

function itemStatus(status: string) {
  if (status === "paid") return "결제 완료";
  if (status === "confirming" || status === "manual_review") return "결과 확인 중";
  return "결제 전";
}

export function EnterprisePaymentClient({ data }: { data: EnterprisePaymentPageData }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = data.items.reduce((sum, item) => sum + item.amountKrw, 0);
  const paid = data.items
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.amountKrw, 0);
  const requestOpen = data.status === "open" || data.status === "partial";

  async function pay(itemId: string) {
    if (!sdkReady || !window.TossPayments || busyItemId) {
      setError("결제창을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setBusyItemId(itemId);
    setError(null);
    let paymentWindow: TossSdkPaymentWindow | null = null;
    try {
      const response = await fetch(
        `/api/enterprise-pay/${encodeURIComponent(data.token)}/items/${encodeURIComponent(itemId)}/prepare`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const prepared = await response.json().catch(() => ({})) as PrepareResponse;
      if (!response.ok) throw new Error(prepared.detail || "결제를 준비하지 못했습니다.");
      const widgets = window.TossPayments(prepared.clientKey).widgets({
        customerKey: "ANONYMOUS",
      });
      await widgets.setAmount({ currency: "KRW", value: prepared.amount });
      paymentWindow = await widgets.renderPaymentWindow();
      paymentWindow.on("cancel", () => {
        void paymentWindow?.destroy();
        setBusyItemId(null);
      });
      paymentWindow.on("paymentRequest", (paymentMethod) => {
        if (paymentMethod.code !== "CARD") {
          setError("이 결제 요청은 개인·법인 카드 결제만 지원합니다.");
          void paymentWindow?.destroy();
          setBusyItemId(null);
          return;
        }
        void widgets.requestPayment({
          paymentMethod,
          orderId: prepared.orderId,
          orderName: prepared.orderName,
          successUrl: prepared.successUrl,
          failUrl: prepared.failUrl,
          customerName: prepared.customerName,
          customerEmail: prepared.customerEmail,
          metadata: { enterprisePaymentAttemptId: prepared.attemptId },
        }).catch((cause) => {
          setError(cause instanceof Error ? cause.message : "결제창을 열지 못했습니다.");
          setBusyItemId(null);
        });
      });
    } catch (cause) {
      if (paymentWindow) await paymentWindow.destroy();
      setError(cause instanceof Error ? cause.message : "결제를 준비하지 못했습니다.");
      setBusyItemId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f1213] px-4 py-10 text-neutral-100 sm:px-6 sm:py-16">
      {requestOpen ? (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
          onError={() => setError("결제창을 불러오지 못했습니다. 새로고침해 주세요.")}
        />
      ) : null}
      <div className="mx-auto max-w-2xl">
        <header className="mb-7 flex items-center justify-between">
          <p className="text-xl font-black tracking-tight text-white">EasyCut</p>
          <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-neutral-400">
            기업 전용 결제
          </span>
        </header>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#181c1d]">
          <div className="border-b border-white/10 p-6 sm:p-9">
            <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9585]">Payment request</p>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">{data.title}</h1>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              {data.customerName} 담당자님, 아래 결제 항목과 금액을 확인해 주세요.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-neutral-500">총 요청 금액</p>
                <p className="mt-1 text-xl font-black text-white">{won(total)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-neutral-500">결제 완료</p>
                <p className="mt-1 text-xl font-black text-emerald-200">{won(paid)}</p>
              </div>
            </div>
            <p className="mt-4 text-xs font-bold text-neutral-300">{requestStatus(data.status)}</p>
            <p className="mt-1 text-xs text-neutral-500">결제 기한 {date(data.expiresAt)}</p>
          </div>

          <div className="grid gap-3 p-5 sm:p-8">
            {data.items.map((item, index) => {
              const itemBusy = busyItemId === item.id;
              const unavailable = !requestOpen
                || item.status === "paid"
                || item.status === "confirming"
                || item.status === "manual_review";
              return (
                <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-neutral-500">결제 {index + 1}</p>
                      <h2 className="mt-1 text-base font-black text-white">{item.name}</h2>
                      <p className="mt-2 text-2xl font-black tracking-tight text-white">{won(item.amountKrw)}</p>
                    </div>
                    <div className="sm:text-right">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${
                        item.status === "paid"
                          ? "bg-emerald-300/10 text-emerald-200"
                          : item.status === "confirming" || item.status === "manual_review"
                            ? "bg-amber-300/10 text-amber-200"
                            : "bg-white/[.06] text-neutral-300"
                      }`}>
                        {itemStatus(item.status)}
                      </span>
                    </div>
                  </div>
                  {item.status === "paid" ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-xs">
                      <span className="text-neutral-500">{item.paidAt ? date(item.paidAt) : "결제 완료"}</span>
                      {item.receiptUrl ? (
                        <a href={item.receiptUrl} target="_blank" rel="noreferrer" className="font-black text-sky-200 underline underline-offset-4">
                          카드 영수증 보기
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={unavailable || busyItemId !== null}
                      onClick={() => void pay(item.id)}
                      className="mt-5 min-h-12 w-full rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff806f] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {itemBusy
                        ? "결제창 여는 중..."
                        : item.status === "confirming" || item.status === "manual_review"
                          ? "결제 결과 확인 중"
                          : `${won(item.amountKrw)} 카드 결제`}
                    </button>
                  )}
                </article>
              );
            })}
            {error ? (
              <p className="rounded-xl border border-red-300/20 bg-red-300/[.08] px-4 py-3 text-sm leading-6 text-red-100" role="alert">
                {error}
              </p>
            ) : null}
            <p className="px-1 pt-2 text-xs leading-6 text-neutral-500">
              각 항목은 별도 카드 승인으로 처리됩니다. 결제 결과 확인 중에는 같은 항목을 다시 결제하지 마세요.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
