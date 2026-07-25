"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdminOrder = {
  id: string;
  orderId: string;
  kind: string;
  productCode: string;
  billingCycle: string | null;
  amountKrw: number;
  refundedAmountKrw: number;
  reservedRefundKrw: number;
  refundStatus: string;
  status: string;
  provider: string;
  providerTransactionId: string | null;
  providerStatus: string | null;
  failureCode: string | null;
  approvedAt: string | null;
  createdAt: string;
  email: string;
  subscriptionStatus: string | null;
};

export type AdminRefund = {
  id: string;
  billingOrderId: string;
  orderId: string;
  email: string;
  adminEmail: string;
  amountKrw: number;
  reason: string;
  status: string;
  entitlementActionStatus: string;
  providerRefundTransactionId: string | null;
  failureMessage: string | null;
  requestedAt: string;
  processedAt: string | null;
};

const statusLabels: Record<string, string> = {
  pending: "대기",
  processing: "처리 중",
  succeeded: "승인",
  failed: "실패",
  unknown: "결과 불명",
  manual_review: "확인 필요",
  canceled: "취소",
  expired: "만료",
  active: "활성",
  past_due: "연체",
  partial: "부분 환불",
  full: "전액 환불",
  none: "-",
  revoked: "권한 회수",
  not_required: "해당 없음",
};

function label(value: string | null) {
  return value ? statusLabels[value] || value : "-";
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value)) : "-";
}

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function shortId(value: string | null) {
  if (!value) return "-";
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function productLabel(code: string) {
  const labels: Record<string, string> = {
    easycut_pro_v2: "이지컷 프로",
    starter_3m: "스타터 3개월",
    starter_6m: "스타터 6개월",
    starter_12m: "스타터 12개월",
    expert_3m: "전문가 3개월",
    expert_6m: "전문가 6개월",
    expert_12m: "전문가 12개월",
    earlybird_300: "얼리버드 300분",
    earlybird_600: "얼리버드 600분",
    earlybird_1000: "얼리버드 1,000분",
  };
  return labels[code] || code;
}

export function AdminBillingDashboard({
  orders,
  refunds,
  initialFilters,
}: {
  orders: AdminOrder[];
  refunds: AdminRefund[];
  initialFilters: { status: string; provider: string; query: string };
}) {
  const router = useRouter();
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openRefund = (order: AdminOrder) => {
    setRefundOrder(order);
    setRefundAmount(order.amountKrw - order.refundedAmountKrw - order.reservedRefundKrw);
    setRefundReason("");
    setMessage(null);
  };

  const submitRefund = async () => {
    if (!refundOrder || submitting) return;
    if (!window.confirm(`${refundOrder.email}의 주문에서 ${money(refundAmount)}을 실제 카드 환불하시겠습니까?`)) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/billing/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          orderId: refundOrder.id,
          amountKrw: refundAmount,
          reason: refundReason,
        }),
      });
      const result = await response.json() as { detail?: string; entitlementRequiresReview?: boolean };
      if (!response.ok) throw new Error(result.detail || "환불 요청에 실패했습니다.");
      setMessage(result.entitlementRequiresReview
        ? "환불이 승인되었습니다. 구독 권한 상태를 별도로 확인해 주세요."
        : "환불과 추가 상품 권한 회수가 완료되었습니다.");
      setRefundOrder(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환불 요청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-7 grid gap-7">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">결제 주문</h2>
              <p className="mt-1 text-xs text-neutral-500">최근 100건 · 승인 금액과 실제 환불 누계 기준</p>
            </div>
            <form className="flex flex-wrap gap-2" method="get">
              <input type="hidden" name="tab" value="billing" />
              <input name="q" defaultValue={initialFilters.query} placeholder="이메일·주문·거래번호" className="h-10 w-56 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]" />
              <select name="provider" defaultValue={initialFilters.provider} className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm">
                <option value="all">모든 결제사</option><option value="thepayone">더페이원</option><option value="nicepay">나이스페이</option>
              </select>
              <select name="status" defaultValue={initialFilters.status} className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm">
                <option value="all">모든 상태</option><option value="succeeded">승인</option><option value="pending">대기</option><option value="processing">처리 중</option><option value="failed">실패</option><option value="manual_review">확인 필요</option><option value="unknown">결과 불명</option><option value="expired">만료</option>
              </select>
              <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">조회</button>
            </form>
          </div>
        </div>

        {message && <p className="border-b border-white/10 bg-[#ff8c7c]/10 px-5 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500"><tr>
              <th className="px-5 py-3">승인 시각</th><th className="px-4 py-3">고객</th><th className="px-4 py-3">상품</th><th className="px-4 py-3">결제사</th><th className="px-4 py-3">결제 / 환불</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">주문번호</th><th className="px-5 py-3 text-right">관리</th>
            </tr></thead>
            <tbody className="divide-y divide-white/[.06]">
              {orders.map((order) => {
                const refundable = order.amountKrw - order.refundedAmountKrw - order.reservedRefundKrw;
                const canRefund = order.provider === "thepayone"
                  && order.status === "succeeded"
                  && Boolean(order.providerTransactionId)
                  && refundable > 0;
                return <tr key={order.id} className="align-top hover:bg-white/[.02]">
                  <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(order.approvedAt || order.createdAt)}</td>
                  <td className="px-4 py-4"><p className="max-w-56 truncate font-bold text-neutral-200">{order.email}</p><p className="mt-1 text-xs text-neutral-600">구독 {label(order.subscriptionStatus)}</p></td>
                  <td className="px-4 py-4"><p className="font-bold">{productLabel(order.productCode)}</p><p className="mt-1 text-xs text-neutral-500">{order.kind} · {order.productCode.startsWith("starter_") || order.productCode.startsWith("expert_") ? "단건 패키지" : order.billingCycle || "단건"}</p></td>
                  <td className="px-4 py-4 font-bold">{order.provider === "thepayone" ? "더페이원" : "나이스페이"}</td>
                  <td className="px-4 py-4"><p className="font-black">{money(order.amountKrw)}</p><p className="mt-1 text-xs text-[#ff9b8d]">환불 {money(order.refundedAmountKrw)} · {label(order.refundStatus)}</p>{order.reservedRefundKrw > 0 && <p className="mt-1 text-xs text-amber-300">기존 환불 처리 중 {money(order.reservedRefundKrw)}</p>}</td>
                  <td className="px-4 py-4"><p className="font-bold">{label(order.status)}</p>{order.failureCode && <p className="mt-1 text-xs text-amber-300">{order.failureCode}</p>}</td>
                  <td className="px-4 py-4 font-mono text-xs text-neutral-500" title={order.orderId}><p>{shortId(order.orderId)}</p><p className="mt-1">{shortId(order.providerTransactionId)}</p></td>
                  <td className="px-5 py-4 text-right">
                    <button type="button" disabled={!canRefund} onClick={() => openRefund(order)} className="rounded-lg border border-[#ff8c7c]/40 px-3 py-2 text-xs font-black text-[#ff9b8d] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-neutral-700">{canRefund ? "환불" : order.provider === "nicepay" ? "수동 확인" : "환불 불가"}</button>
                  </td>
                </tr>;
              })}
              {!orders.length && <tr><td colSpan={8} className="px-5 py-16 text-center text-neutral-500">조건에 맞는 결제 주문이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">환불 기록</h2><p className="mt-1 text-xs text-neutral-500">관리자, 사유, 결제사 결과와 권한 처리 상태를 보존합니다.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-5 py-3">요청 시각</th><th className="px-4 py-3">고객 / 주문</th><th className="px-4 py-3">금액</th><th className="px-4 py-3">사유</th><th className="px-4 py-3">환불 상태</th><th className="px-4 py-3">권한 처리</th><th className="px-5 py-3">처리 관리자</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">
            {refunds.map((refund) => <tr key={refund.id} className="align-top">
              <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(refund.requestedAt)}</td>
              <td className="px-4 py-4"><p className="font-bold">{refund.email}</p><p className="mt-1 font-mono text-xs text-neutral-600">{shortId(refund.orderId)}</p></td>
              <td className="px-4 py-4 font-black">{money(refund.amountKrw)}</td>
              <td className="max-w-sm px-4 py-4 text-neutral-300">{refund.reason}{refund.failureMessage && <p className="mt-1 text-xs text-amber-300">{refund.failureMessage}</p>}</td>
              <td className="px-4 py-4 font-bold">{label(refund.status)}</td>
              <td className="px-4 py-4 font-bold">{label(refund.entitlementActionStatus)}</td>
              <td className="px-5 py-4 text-neutral-400">{refund.adminEmail}</td>
            </tr>)}
            {!refunds.length && <tr><td colSpan={7} className="px-5 py-12 text-center text-neutral-500">환불 기록이 없습니다.</td></tr>}
          </tbody>
        </table></div>
      </section>

      {refundOrder && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="refund-title">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">Actual card refund</p><h3 id="refund-title" className="mt-2 text-xl font-black">실제 카드 환불</h3></div><button type="button" onClick={() => setRefundOrder(null)} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[.06]">닫기</button></div>
          <dl className="mt-5 grid grid-cols-[100px_1fr] gap-2 rounded-2xl bg-black/20 p-4 text-sm"><dt className="text-neutral-500">고객</dt><dd className="font-bold">{refundOrder.email}</dd><dt className="text-neutral-500">주문</dt><dd className="break-all font-mono text-xs">{refundOrder.orderId}</dd><dt className="text-neutral-500">잔여 가능액</dt><dd className="font-black">{money(refundOrder.amountKrw-refundOrder.refundedAmountKrw-refundOrder.reservedRefundKrw)}</dd></dl>
          <label className="mt-5 block text-sm font-bold">환불 금액<input type="number" min={1} max={refundOrder.amountKrw-refundOrder.refundedAmountKrw-refundOrder.reservedRefundKrw} value={refundAmount} onChange={(event) => setRefundAmount(Number(event.target.value))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-lg font-black outline-none focus:border-[#ff8c7c]" /></label>
          <label className="mt-4 block text-sm font-bold">환불 사유<textarea value={refundReason} onChange={(event) => setRefundReason(event.target.value)} maxLength={500} rows={4} placeholder="고객 요청, 중복 결제 등 구체적인 사유" className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]" /></label>
          <p className="mt-4 text-xs leading-5 text-amber-200/80">이 버튼은 더페이원 실제 환불 API를 호출합니다. 구독 결제 환불 후 권한과 자동결제 상태는 관리자 확인 대상으로 남습니다.</p>
          <div className="mt-6 flex gap-3"><button type="button" onClick={() => setRefundOrder(null)} className="h-12 flex-1 rounded-xl border border-white/10 font-bold">취소</button><button type="button" disabled={submitting || refundAmount < 1 || refundAmount > refundOrder.amountKrw-refundOrder.refundedAmountKrw-refundOrder.reservedRefundKrw || refundReason.trim().length < 2} onClick={() => void submitRefund()} className="h-12 flex-1 rounded-xl bg-[#ff806f] font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{submitting ? "처리 중..." : "환불 실행"}</button></div>
        </div>
      </div>}
    </div>
  );
}
