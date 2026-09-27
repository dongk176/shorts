"use client";
import { useEffect, useState } from "react";
import { formatAdminCurrency, type PaddleSalesTotal } from "@/lib/admin-paddle-contract";

export function AdminPaddleSales() {
  const [totals, setTotals] = useState<PaddleSalesTotal[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setError(false);
    setTotals(null);
    const timeout = setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/admin/billing/paddle-summary", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("summary unavailable");
        const data = await response.json() as { totals: PaddleSalesTotal[] };
        if (active) setTotals(data.totals);
      }).catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <section className="my-5 rounded-2xl border border-white/10 bg-[#151819] p-5" aria-label="Paddle 해외 매출">
    <h2 className="text-lg font-black">Paddle 해외 매출</h2>
    <p className="mt-1 text-xs text-neutral-400">국내 원화 매출과 별도 집계 · 실결제만 표시 · 세금 포함, 수수료 차감 전</p>
    {error ? <div role="alert" className="mt-4 text-sm text-amber-200">매출을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button></div>
      : !totals ? <p role="status" className="mt-4 text-sm text-neutral-400">Paddle 매출을 불러오는 중…</p>
      : <div className="mt-4 grid gap-4 sm:grid-cols-2">{totals.map((total) => <article key={total.currency} className="rounded-xl border border-white/10 p-4">
        <h3 className="font-bold">{total.currency === "USD" ? "미국 달러 · USD" : "일본 엔 · JPY"}</h3>
        <p className="mt-2 text-2xl font-black">{formatAdminCurrency(total.grossMinor, total.currency)}</p>
        <p className="mt-1 text-xs text-neutral-400">누적 결제 {total.paidOrders.toLocaleString("ko-KR")}건</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-2"><dt>오늘 결제 · {total.todayPaidOrders}건</dt><dd>{formatAdminCurrency(total.todayGrossMinor, total.currency)}</dd></div>
          <div className="flex justify-between gap-2"><dt>환불 완료</dt><dd>{formatAdminCurrency(total.refundedMinor, total.currency)}</dd></div>
          <div className="flex justify-between gap-2"><dt>차지백</dt><dd>{formatAdminCurrency(total.chargebackMinor, total.currency)}</dd></div>
          <div className="flex justify-between gap-2 font-bold"><dt>환불·차지백 차감 후</dt><dd>{formatAdminCurrency(total.netMinor, total.currency)}</dd></div>
          {total.pendingRefundMinor > 0 && <div className="flex justify-between gap-2 text-amber-200"><dt>환불 승인 대기</dt><dd>{formatAdminCurrency(total.pendingRefundMinor, total.currency)}</dd></div>}
        </dl>
      </article>)}</div>}
    <p className="mt-3 text-xs text-neutral-500">오늘은 한국 시간의 결제 기록 수신일 기준입니다. 실결제 테스트도 포함되며, 실제 정산액은 Paddle에서 확인하세요.</p>
  </section>;
}
