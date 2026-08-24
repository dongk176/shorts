"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminPaymentDetailParts,
  adminPaymentFailureLabel,
  adminPaymentFlowLabel,
} from "@/lib/admin-billing-presentation";

export type AdminOrder = {
  id: string;
  orderId: string;
  kind: string;
  productCode: string;
  billingCycle: string | null;
  prepaidMonths: number;
  refundPolicyVersion: number;
  amountKrw: number;
  refundedAmountKrw: number;
  reservedRefundKrw: number;
  refundStatus: string;
  status: string;
  provider: string;
  providerTransactionId: string | null;
  providerStatus: string | null;
  providerTerminalId: string | null;
  hasPaymentMethod: boolean;
  credentialScope: string | null;
  installmentMonths: number;
  cardIssuerName: string | null;
  installmentBenefitType: string | null;
  declaredCardKind: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  approvedAt: string | null;
  createdAt: string;
  email: string;
  subscriptionStatus: string | null;
  contractPeriodStart: string | null;
  contractPeriodEnd: string | null;
  currentPackageMonthUsed: boolean;
  firstCompletedJobAt: string | null;
  popularFilterUsageCount: number;
  popularFilterLastUsedAt: string | null;
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

export type RemediationMetrics = {
  total: number;
  required: number;
  registering: number;
  awaitingProvider: number;
  completed: number;
  expired: number;
  manualReview: number;
  staleRegistering: number;
  snapshotChanged: number;
  duplicateActiveSchedules: number;
  claimsEnabled: boolean;
  reconciliationEnabled: boolean;
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
  scheduled_end: "월말 종료 예약",
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
  initialHasMore,
  initialNextOffset,
  remediationMetrics,
}: {
  orders: AdminOrder[];
  refunds: AdminRefund[];
  initialFilters: { status: string; provider: string; query: string };
  initialHasMore: boolean;
  initialNextOffset: number;
  remediationMetrics: RemediationMetrics | null;
}) {
  const router = useRouter();
  const [loadedOrders, setLoadedOrders] = useState(orders);
  const [hasMoreOrders, setHasMoreOrders] = useState(initialHasMore);
  const [nextOrderOffset, setNextOrderOffset] = useState(initialNextOffset);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [manualReviewOrder, setManualReviewOrder] = useState<AdminOrder | null>(null);
  const [manualReviewNote, setManualReviewNote] = useState("");
  const [manualReviewRequestId, setManualReviewRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoadedOrders(orders);
    setHasMoreOrders(initialHasMore);
    setNextOrderOffset(initialNextOffset);
    setLoadMoreError(null);
  }, [initialHasMore, initialNextOffset, orders]);

  const loadMoreOrders = async () => {
    if (loadingMoreOrders || !hasMoreOrders) return;
    setLoadingMoreOrders(true);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams({
        offset: String(nextOrderOffset),
        status: initialFilters.status,
        provider: initialFilters.provider,
      });
      if (initialFilters.query) params.set("q", initialFilters.query);
      const response = await fetch(`/api/admin/billing/orders?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json() as {
        orders?: AdminOrder[];
        hasMore?: boolean;
        nextOffset?: number;
        detail?: string;
      };
      if (!response.ok || !Array.isArray(result.orders)) {
        throw new Error(result.detail || "결제 주문을 더 불러오지 못했습니다.");
      }
      setLoadedOrders((current) => {
        const knownIds = new Set(current.map((order) => order.id));
        return [...current, ...result.orders!.filter((order) => !knownIds.has(order.id))];
      });
      setHasMoreOrders(Boolean(result.hasMore));
      setNextOrderOffset(Number(result.nextOffset ?? nextOrderOffset));
    } catch (error) {
      setLoadMoreError(error instanceof Error
        ? error.message
        : "결제 주문을 더 불러오지 못했습니다.");
    } finally {
      setLoadingMoreOrders(false);
    }
  };

  const openManualReview = (order: AdminOrder) => {
    setManualReviewOrder(order);
    setManualReviewNote("");
    setManualReviewRequestId(crypto.randomUUID());
    setMessage(null);
  };

  const submitManualReview = async () => {
    if (!manualReviewOrder || submitting || !manualReviewRequestId) return;
    if (!window.confirm(`${manualReviewOrder.orderId}에 더페이원 승인 내역이 없음을 확인했습니까?`)) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/billing/manual-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "no_approval",
          requestId: manualReviewRequestId,
          orderId: manualReviewOrder.id,
          note: manualReviewNote,
          confirmation: "PG 승인 없음 확인",
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "PG 대조 결과 처리에 실패했습니다.");
      setMessage("PG 승인 없음으로 종결했습니다. 고객 권한은 지급되지 않았습니다.");
      setManualReviewOrder(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PG 대조 결과 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-7 grid gap-7">
      {remediationMetrics && remediationMetrics.total > 0 && (
        <section className="rounded-2xl border border-[#ff8c7c]/20 bg-[#151819] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">기존 정기결제 카드 확인</h2>
              <p className="mt-1 text-xs text-neutral-500">대상 {remediationMetrics.total.toLocaleString("ko-KR")}명 · 신규 카드 추가 {remediationMetrics.claimsEnabled ? "사용" : "중지"} · PG 결과 처리 {remediationMetrics.reconciliationEnabled ? "사용" : "중지"}</p>
            </div>
            {(remediationMetrics.staleRegistering > 0 || remediationMetrics.snapshotChanged > 0 || remediationMetrics.duplicateActiveSchedules > 0) && (
              <span className="rounded-full bg-red-400/10 px-3 py-1 text-xs font-black text-red-200">즉시 확인 필요</span>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["확인 필요", remediationMetrics.required],
              ["등록 중", remediationMetrics.registering],
              ["PG 대기", remediationMetrics.awaitingProvider],
              ["완료", remediationMetrics.completed],
              ["만료", remediationMetrics.expired],
              ["수동 확인", remediationMetrics.manualReview],
              ["복수 활성", remediationMetrics.duplicateActiveSchedules],
            ].map(([title, value]) => (
              <div key={String(title)} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-xs text-neutral-500">{title}</p>
                <p className="mt-1 text-xl font-black text-white">{Number(value).toLocaleString("ko-KR")}</p>
              </div>
            ))}
          </div>
          {(remediationMetrics.staleRegistering > 0 || remediationMetrics.snapshotChanged > 0) && (
            <p className="mt-4 text-xs font-bold text-amber-200">2분 이상 등록 중 {remediationMetrics.staleRegistering}건 · 결제일 스냅샷 변경 {remediationMetrics.snapshotChanged}건</p>
          )}
        </section>
      )}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">결제 주문</h2>
              <p className="mt-1 text-xs text-neutral-500">현재 {loadedOrders.length.toLocaleString("ko-KR")}건 표시 · 승인 금액과 실제 환불 누계 기준</p>
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
              {loadedOrders.map((order) => {
                const paymentFlow = adminPaymentFlowLabel(order);
                const paymentDetails = adminPaymentDetailParts(order);
                const paymentFailure = adminPaymentFailureLabel(order);
                const canResolveManualReview = order.provider === "thepayone"
                  && ["manual_review", "unknown"].includes(order.status)
                  && order.refundStatus === "none";
                return <tr key={order.id} className="align-top hover:bg-white/[.02]">
                  <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(order.approvedAt || order.createdAt)}</td>
                  <td className="px-4 py-4"><p className="max-w-56 truncate font-bold text-neutral-200">{order.email}</p><p className="mt-1 text-xs text-neutral-600">구독 {label(order.subscriptionStatus)}</p></td>
                  <td className="px-4 py-4"><p className="font-bold">{productLabel(order.productCode)}</p><p className="mt-1 text-xs text-neutral-500">{order.kind} · {order.productCode?.startsWith("starter_") || order.productCode?.startsWith("expert_") ? "단건 패키지" : order.billingCycle || "단건"}</p>{order.popularFilterUsageCount > 0 && <p className="mt-1 text-xs font-bold text-amber-300">유료 인기 필터 {order.popularFilterUsageCount}회 사용</p>}</td>
                  <td className="px-4 py-4">
                    <p className="font-bold">{order.provider === "thepayone" ? "더페이원" : "나이스페이"}</p>
                    {(paymentFlow || order.providerTerminalId) && <p className="mt-1 text-xs font-bold text-neutral-400">{[paymentFlow, order.providerTerminalId].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black">{money(order.amountKrw)}</p>
                    <p className="mt-1 text-xs font-bold text-neutral-300">{paymentDetails.join(" · ")}</p>
                    <p className="mt-1 text-xs text-[#ff9b8d]">환불 {money(order.refundedAmountKrw)} · {label(order.refundStatus)}</p>
                    {order.reservedRefundKrw > 0 && <p className="mt-1 text-xs text-amber-300">기존 환불 처리 중 {money(order.reservedRefundKrw)}</p>}
                  </td>
                  <td className="px-4 py-4"><p className="font-bold">{label(order.status)}</p>{paymentFailure && <p className="mt-1 text-xs text-amber-300">{paymentFailure}</p>}</td>
                  <td className="px-4 py-4 font-mono text-xs text-neutral-500" title={order.orderId}><p>{shortId(order.orderId)}</p><p className="mt-1">{shortId(order.providerTransactionId)}</p></td>
                  <td className="px-5 py-4 text-right">
                    {canResolveManualReview
                      ? <button type="button" onClick={() => openManualReview(order)} className="rounded-lg border border-amber-300/40 px-3 py-2 text-xs font-black text-amber-200">PG 대조 처리</button>
                      : <span className="inline-block rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-neutral-500">PG에서 직접 처리</span>}
                  </td>
                </tr>;
              })}
              {!loadedOrders.length && <tr><td colSpan={8} className="px-5 py-16 text-center text-neutral-500">조건에 맞는 결제 주문이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {(hasMoreOrders || loadMoreError) && <div className="border-t border-white/10 px-5 py-4 text-center">
          {loadMoreError && <p role="alert" className="mb-3 text-sm font-bold text-[#ff9b8d]">{loadMoreError}</p>}
          {hasMoreOrders && <button
            type="button"
            disabled={loadingMoreOrders}
            onClick={() => void loadMoreOrders()}
            className="min-h-11 rounded-xl border border-white/15 bg-white/[.04] px-6 text-sm font-black text-white transition hover:bg-white/[.08] disabled:cursor-wait disabled:opacity-50"
          >
            {loadingMoreOrders ? "불러오는 중…" : "더보기"}
          </button>}
        </div>}
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

      {manualReviewOrder && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="manual-review-title">
        <div className="w-full max-w-lg rounded-3xl border border-amber-300/20 bg-[#191c1d] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Manual review</p><h3 id="manual-review-title" className="mt-2 text-xl font-black">결과 불명 결제 PG 대조</h3></div>
            <button type="button" onClick={() => setManualReviewOrder(null)} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[.06]">닫기</button>
          </div>
          <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.07] px-4 py-3 text-xs font-bold leading-5 text-amber-100">더페이원 관리자에서 주문번호·금액·arti02 거래를 먼저 조회하세요. 승인 여부가 확인되기 전에는 고객 권한을 지급하지 않습니다.</p>
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs font-bold leading-5 text-neutral-300">승인 또는 환불이 필요한 거래는 PG 관리자에서 직접 처리하세요. 이 화면에서는 실제 결제 취소를 실행하지 않습니다.</p>
          <dl className="mt-4 grid grid-cols-[92px_1fr] gap-2 rounded-2xl bg-black/20 p-4 text-sm">
            <dt className="text-neutral-500">주문</dt><dd className="break-all font-mono text-xs">{manualReviewOrder.orderId}</dd>
            <dt className="text-neutral-500">고객</dt><dd className="font-bold">{manualReviewOrder.email}</dd>
            <dt className="text-neutral-500">금액</dt><dd className="font-black">{money(manualReviewOrder.amountKrw)}</dd>
            <dt className="text-neutral-500">현재 상태</dt><dd className="font-bold text-amber-200">{label(manualReviewOrder.status)}</dd>
          </dl>
          <label className="mt-4 block text-sm font-bold">대조 메모
            <textarea value={manualReviewNote} onChange={(event) => setManualReviewNote(event.target.value)} maxLength={400} rows={3} placeholder="확인 시각과 PG 조회 결과" className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 outline-none placeholder:text-neutral-600 focus:border-amber-300" />
          </label>
          <div className="mt-6">
            <button type="button" disabled={submitting || manualReviewNote.trim().length < 2} onClick={() => void submitManualReview()} className="min-h-12 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40">{submitting ? "처리 중..." : "승인 없음으로 종결"}</button>
          </div>
          {manualReviewOrder.providerTransactionId && <p className="mt-3 text-xs leading-5 text-amber-200/80">주문에는 승인 거래번호가 기록되어 있습니다. PG 관리자에서 해당 번호와 주문번호 모두 승인 없음으로 확인한 경우에만 ‘승인 없음’으로 종결하세요.</p>}
        </div>
      </div>}
    </div>
  );
}
