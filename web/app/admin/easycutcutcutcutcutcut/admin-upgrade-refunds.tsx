"use client";

import { useState } from "react";

type UpgradeRefund = {
  id: string;
  email: string;
  sourceProviderTransactionId: string;
  upgradeOrderNumber: string;
  refundAmountKrw: number;
  status: string;
  adminNote: string;
};

export function AdminUpgradeRefunds() {
  const [refunds, setRefunds] = useState<UpgradeRefund[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UpgradeRefund | null>(null);
  const [reference, setReference] = useState("");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/billing/upgrade-refunds", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "환불 목록을 불러오지 못했습니다.");
      setRefunds(body.refunds.filter((item: UpgradeRefund) => item.status !== "completed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "조회에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function recordCompleted() {
    if (!selected || !reference.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/billing/upgrade-refunds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action: "completed", providerReference: reference.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "환불 완료 기록에 실패했습니다.");
      setRefunds((items) => items?.filter((item) => item.id !== selected.id) ?? null);
      setSelected(null);
      setReference("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-black text-amber-100">더페이원 업그레이드 환불 대기</h2>
          <p className="mt-2 text-sm text-neutral-300">새 이용권·사용량은 적용되며, 기존 결제의 미처리 환불을 여기서 확인할 수 있습니다.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()} className="min-h-10 rounded-xl border border-amber-200/30 px-4 text-sm font-bold text-amber-100 disabled:opacity-50">
          {busy ? "처리 중…" : refunds === null ? "환불 대기 확인" : "새로고침"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {refunds?.length === 0 && <p className="mt-4 text-sm text-neutral-400">미처리 업그레이드 환불이 없습니다.</p>}
      {refunds && refunds.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-400"><tr><th className="p-2">고객</th><th className="p-2">환불 금액 / 원거래</th><th className="p-2">확인 내용</th><th className="p-2">처리</th></tr></thead>
            <tbody>{refunds.map((item) => (
              <tr key={item.id} className="border-t border-white/10">
                <td className="p-2">{item.email}<span className="mt-1 block text-xs text-neutral-500">{item.upgradeOrderNumber}</span></td>
                <td className="p-2">{Number(item.refundAmountKrw).toLocaleString("ko-KR")}원<span className="mt-1 block text-xs text-neutral-400">{item.sourceProviderTransactionId}</span></td>
                <td className="max-w-md p-2 text-xs leading-5 text-neutral-300">{item.adminNote || "기존 결제의 환불을 직접 처리해 주세요."}</td>
                <td className="p-2"><button type="button" disabled={busy} onClick={() => { setSelected(item); setReference(""); }} className="whitespace-nowrap rounded-lg border border-white/20 px-3 py-2">환불 완료 기록</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {selected && (
        <form className="mt-4 rounded-xl border border-white/15 p-4" onSubmit={(event) => { event.preventDefault(); void recordCompleted(); }}>
          <p className="text-sm font-bold">{selected.email} · {Number(selected.refundAmountKrw).toLocaleString("ko-KR")}원</p>
          <p className="mt-2 text-xs leading-5 text-neutral-300">PG 원거래의 취소 여부를 먼저 확인하고, 이미 환불됐다면 다시 송금하지 마세요. 실제 환불을 마친 뒤 기록해 주세요. 이 버튼은 돈을 환불하거나 새 이용권을 회수하지 않습니다.</p>
          <label className="mt-3 block text-sm">환불 거래번호 또는 이체 확인번호
            <input required maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-2 block w-full rounded-lg border border-white/20 bg-black/30 p-2" />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy || !reference.trim()} className="rounded-lg bg-amber-200 px-4 py-2 text-sm font-bold text-black disabled:opacity-50">실제 환불 완료로 기록</button>
            <button type="button" disabled={busy} onClick={() => setSelected(null)} className="rounded-lg border border-white/20 px-4 py-2 text-sm">닫기</button>
          </div>
        </form>
      )}
    </section>
  );
}
