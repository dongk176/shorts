"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  adminRefundActions,
  adminRefundBillingActions,
  adminRefundCaseStatuses,
  adminRefundEntitlementActions,
  buildRefundGuide,
  type AdminRefundAction,
  type AdminRefundBillingAction,
  type AdminRefundCaseStatus,
  type AdminRefundEntitlementAction,
  type AdminRefundPaymentStatus,
} from "@/lib/admin-refund-case";
import {
  adminRefundReasonCodes,
  adminRefundReasonLabel,
  quoteFirstCompletedJobRefund,
  type AdminRefundReasonCode,
} from "@/lib/refund-policy";

export type AdminRefundCase = {
  id: string;
  billingOrderId: string;
  orderId: string;
  productCode: string;
  productName: string;
  orderAmountKrw: number;
  orderRefundedAmountKrw: number;
  approvedAt: string | null;
  provider: string;
  providerTransactionId: string | null;
  userId: string;
  email: string;
  displayName: string | null;
  status: AdminRefundCaseStatus;
  reasonCode: AdminRefundReasonCode;
  reasonDetail: string;
  firstJobCompleted: boolean;
  firstCompletedJobAt: string | null;
  prepaidMonths: number;
  monthlyDeductionKrw: number;
  calculatedRefundKrw: number;
  plannedRefundKrw: number;
  refundAction: AdminRefundAction;
  paymentStatus: AdminRefundPaymentStatus;
  billingAction: AdminRefundBillingAction;
  entitlementAction: AdminRefundEntitlementAction;
  entitlementEffectiveAt: string | null;
  serviceActionStatus: string;
  providerReference: string | null;
  adminNote: string | null;
  subscriptionStatus: string | null;
  assignedAdminEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminRefundCaseMetrics = {
  unprocessed: number;
  inProgress: number;
  completed: number;
  manualReview: number;
  recentRefundKrw: number;
};

type SearchResult = {
  id: string;
  orderId: string;
  orderName: string;
  kind: string;
  productCode: string;
  productName: string | null;
  billingCycle: string | null;
  amountKrw: number;
  refundedAmountKrw: number;
  status: string;
  provider: string;
  providerTransactionId: string | null;
  approvedAt: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  userId: string;
  email: string;
  displayName: string | null;
  prepaidMonths: number | null;
  firstCompletedJobId: string | null;
  firstCompletedJobAt: string | null;
  openCaseId: string | null;
  openCaseStatus: string | null;
};

const caseStatusLabels: Record<AdminRefundCaseStatus, string> = {
  unprocessed: "미처리",
  in_progress: "진행 중",
  completed: "완료",
  manual_review: "확인 필요",
  closed: "종결",
};

const paymentStatusLabels: Record<string, string> = {
  not_started: "미처리",
  submitted: "PG 요청됨",
  completed: "환불 완료",
  failed: "실패",
  manual_review: "확인 필요",
};

const serviceStatusLabels: Record<string, string> = {
  not_requested: "미실행",
  processing: "처리 중",
  succeeded: "처리 완료",
  failed: "실패",
  manual_review: "확인 필요",
};

const billingActionLabels: Record<AdminRefundBillingAction, string> = {
  none: "자동결제 변경 없음",
  pause_now_keep_until_period_end: "자동결제 즉시 중지·현재 기간 유지",
};

const entitlementActionLabels: Record<AdminRefundEntitlementAction, string> = {
  none: "이용권 변경 없음",
  revoke_now: "이용권 즉시 종료",
  end_at_current_period: "현재 이용기간 종료 시 종료",
};

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function date(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function statusTone(status: AdminRefundCaseStatus) {
  if (status === "completed") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "manual_review") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (status === "in_progress") return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  return "border-white/10 bg-white/[.04] text-neutral-300";
}

export function AdminRefundsDashboard({
  refundCases,
  metrics,
  initialFilters,
}: {
  refundCases: AdminRefundCase[];
  metrics: AdminRefundCaseMetrics;
  initialFilters: { status: string; query: string };
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<SearchResult | null>(null);
  const [reasonCode, setReasonCode] = useState<AdminRefundReasonCode>("customer_early_termination");
  const [reasonDetail, setReasonDetail] = useState("");
  const [refundAction, setRefundAction] = useState<AdminRefundAction>("policy_refund");
  const [manualRefundKrw, setManualRefundKrw] = useState(0);
  const [billingAction, setBillingAction] = useState<AdminRefundBillingAction>("none");
  const [entitlementAction, setEntitlementAction] = useState<AdminRefundEntitlementAction>("none");
  const [adminNote, setAdminNote] = useState("");
  const [editing, setEditing] = useState<AdminRefundCase | null>(null);
  const [editingStatus, setEditingStatus] = useState<AdminRefundCaseStatus>("unprocessed");
  const [editingPaymentStatus, setEditingPaymentStatus] = useState("not_started");
  const [editingProviderReference, setEditingProviderReference] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPrepaidMonths = Number(
    selectedOrder?.prepaidMonths
      || (selectedOrder?.billingCycle === "yearly" ? 12 : 1),
  );
  const selectedQuote = selectedOrder ? quoteFirstCompletedJobRefund({
    actualPaymentKrw: Number(selectedOrder.amountKrw),
    refundedOrReservedKrw: Number(selectedOrder.refundedAmountKrw || 0),
    prepaidMonths: selectedPrepaidMonths,
    firstJobCompleted: Boolean(selectedOrder.firstCompletedJobAt),
  }) : null;
  const selectedPlannedRefundKrw = refundAction === "none"
    ? 0
    : refundAction === "manual_amount"
      ? manualRefundKrw
      : selectedQuote?.refundAmountKrw || 0;

  const searchOrders = async () => {
    const query = searchQuery.trim();
    if (query.length < 2 || searching) return;
    setSearching(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/refunds/search?q=${encodeURIComponent(query)}`, {
        credentials: "same-origin",
      });
      const result = await response.json() as { results?: SearchResult[]; detail?: string };
      if (!response.ok) throw new Error(result.detail || "결제 검색에 실패했습니다.");
      setSearchResults(result.results || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제 검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const selectOrder = (order: SearchResult) => {
    setSelectedOrder(order);
    setReasonCode(order.kind === "addon" ? "statutory_withdrawal_unused" : "customer_early_termination");
    setRefundAction("policy_refund");
    setManualRefundKrw(0);
    if (order.provider === "thepayone" && order.billingCycle === "monthly") {
      setBillingAction("pause_now_keep_until_period_end");
      setEntitlementAction("end_at_current_period");
    } else {
      setBillingAction("none");
      setEntitlementAction(order.firstCompletedJobAt ? "end_at_current_period" : "revoke_now");
    }
  };

  const createCase = async () => {
    if (!selectedOrder || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/refunds/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          billingOrderId: selectedOrder.id,
          reasonCode,
          reasonDetail,
          refundAction,
          manualRefundKrw: refundAction === "manual_amount" ? manualRefundKrw : undefined,
          billingAction,
          entitlementAction,
          adminNote,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "환불 건을 추가하지 못했습니다.");
      setAdding(false);
      setSelectedOrder(null);
      setSearchResults([]);
      setSearchQuery("");
      setReasonDetail("");
      setAdminNote("");
      setMessage(selectedOrder.provider === "toss"
        ? "토스 환불 건을 등록했습니다. 상세 관리에서 실제 카드 환불을 실행할 수 있습니다."
        : "환불 건을 미처리 상태로 추가했습니다. 실제 카드 환불은 실행되지 않았습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환불 건을 추가하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditor = (refundCase: AdminRefundCase) => {
    setEditing(refundCase);
    setEditingStatus(refundCase.status);
    setEditingPaymentStatus(refundCase.paymentStatus);
    setEditingProviderReference(refundCase.providerReference || "");
    setEditingNote(refundCase.adminNote || "");
    setMessage(null);
  };

  const updateCase = async () => {
    if (!editing || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/refunds/cases/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          status: editingStatus,
          paymentStatus: editingPaymentStatus,
          providerReference: editingProviderReference || undefined,
          adminNote: editingNote || undefined,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "상태 변경에 실패했습니다.");
      setEditing(null);
      setMessage("환불 관리 상태만 변경했습니다. 카드 환불이나 결제사 호출은 실행되지 않았습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const executeServiceAction = async () => {
    if (!editing || submitting) return;
    const confirmed = window.confirm(
      "선택된 자동결제 중지·이용권 종료 작업을 실제로 실행합니다. 카드 결제 환불은 실행하지 않습니다. 계속하시겠습니까?",
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/refunds/cases/${editing.id}/service-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation: "서비스 처리 실행" }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "구독·이용권 처리에 실패했습니다.");
      setEditing(null);
      setMessage("자동결제·이용권 처리를 완료했습니다. 카드 환불은 실행하지 않았습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "구독·이용권 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const executeTossPaymentRefund = async () => {
    if (!editing || editing.provider !== "toss" || submitting) return;
    const confirmed = window.confirm(
      `토스 카드에 ${money(editing.plannedRefundKrw)}을 실제로 환불합니다. 이 작업은 결제사에 즉시 전송됩니다. 계속하시겠습니까?`,
    );
    if (!confirmed) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/refunds/cases/${editing.id}/payment-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation: "토스 환불 실행" }),
      });
      const result = await response.json() as { state?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail || "토스 카드 환불에 실패했습니다.");
      setEditing(null);
      setMessage(
        result.state === "succeeded" || result.state === "already_succeeded"
          ? "토스 실제 카드 환불을 완료했습니다."
          : "토스 환불 결과를 상점관리자에서 직접 확인해 주세요.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "토스 카드 환불에 실패했습니다.");
      setEditing(null);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const copyGuide = async (refundCase: AdminRefundCase) => {
    const copy = buildRefundGuide({
      customerName: refundCase.displayName,
      email: refundCase.email,
      orderId: refundCase.orderId,
      productName: refundCase.productName,
      approvedAt: refundCase.approvedAt,
      amountKrw: refundCase.orderAmountKrw,
      firstJobCompleted: refundCase.firstJobCompleted,
      firstCompletedJobAt: refundCase.firstCompletedJobAt,
      monthlyDeductionKrw: refundCase.monthlyDeductionKrw,
      plannedRefundKrw: refundCase.plannedRefundKrw,
      status: refundCase.status,
      paymentStatus: refundCase.paymentStatus,
      providerReference: refundCase.providerReference,
      billingAction: refundCase.billingAction,
      entitlementAction: refundCase.entitlementAction,
      entitlementEffectiveAt: refundCase.entitlementEffectiveAt,
    });
    try {
      await navigator.clipboard.writeText(copy);
      setMessage(`${refundCase.email} 고객 안내문을 복사했습니다.`);
    } catch {
      setMessage("브라우저에서 클립보드 복사를 허용해 주세요.");
    }
  };

  return (
    <div className="mt-7 grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="환불 업무 요약">
        {[
          ["미처리", metrics.unprocessed, "건"],
          ["진행 중", metrics.inProgress, "건"],
          ["완료", metrics.completed, "건"],
          ["확인 필요", metrics.manualReview, "건"],
          ["최근 30일 환불 완료 기록액", metrics.recentRefundKrw, "원"],
        ].map(([label, value, unit]) => (
          <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{Number(value).toLocaleString("ko-KR")}{unit}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">환불 관리</h2>
              <p className="mt-1 text-xs text-neutral-500">토스 결제는 실제 카드 환불을 실행할 수 있으며, 더페이원은 기존 수동 관리 방식을 유지합니다.</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 xl:w-auto">
              <form className="flex flex-1 flex-wrap gap-2 xl:flex-none" method="get">
                <input type="hidden" name="tab" value="refunds" />
                <input name="q" defaultValue={initialFilters.query} placeholder="이메일·주문번호·환불 건 ID" className="h-10 min-w-56 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none" />
                <select name="refundStatus" defaultValue={initialFilters.status} className="h-10 rounded-xl border border-white/10 bg-[#151819] px-3 text-sm">
                  <option value="all">전체 상태</option>
                  {adminRefundCaseStatuses.map((status) => <option key={status} value={status}>{caseStatusLabels[status]}</option>)}
                </select>
                <button className="h-10 rounded-xl border border-white/10 px-4 text-sm font-black">조회</button>
              </form>
              <button type="button" onClick={() => setAdding(true)} className="h-10 rounded-xl bg-[#ff806f] px-4 text-sm font-black text-white">환불 건 추가</button>
            </div>
          </div>
        </div>
        {message ? <p role="status" className="border-b border-white/10 bg-[#ff8c7c]/10 px-5 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1520px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500">
              <tr>
                <th className="px-5 py-3">등록 / 상태</th>
                <th className="px-4 py-3">고객 / 주문</th>
                <th className="px-4 py-3">상품 / 결제</th>
                <th className="px-4 py-3">첫 작업</th>
                <th className="px-4 py-3">환불 산정</th>
                <th className="px-4 py-3">환불 기록</th>
                <th className="px-4 py-3">구독·이용권</th>
                <th className="px-4 py-3">담당</th>
                <th className="px-5 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {refundCases.map((refundCase) => (
                <tr key={refundCase.id} className="align-top hover:bg-white/[.02]">
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(refundCase.status)}`}>{caseStatusLabels[refundCase.status]}</span>
                    <p className="mt-2 whitespace-nowrap text-xs text-neutral-500">{date(refundCase.createdAt)}</p>
                    <p className="mt-1 font-mono text-[10px] text-neutral-700">{refundCase.id}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="max-w-64 truncate font-bold">{refundCase.email}</p>
                    <p className="mt-1 text-xs text-neutral-500">{refundCase.displayName || "이름 없음"}</p>
                    <p className="mt-2 max-w-64 break-all font-mono text-xs text-neutral-500">{refundCase.orderId}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black">{refundCase.productName}</p>
                    <p className="mt-1 text-xs text-neutral-500">{money(refundCase.orderAmountKrw)} · {date(refundCase.approvedAt)}</p>
                    <p className="mt-1 text-xs text-neutral-600">{refundCase.provider}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className={refundCase.firstJobCompleted ? "font-black text-amber-200" : "font-bold text-emerald-200"}>{refundCase.firstJobCompleted ? "완료" : "완료 기록 없음"}</p>
                    <p className="mt-1 text-xs text-neutral-500">{date(refundCase.firstCompletedJobAt)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black text-[#ffb4a8]">{money(refundCase.plannedRefundKrw)}</p>
                    <p className="mt-1 text-xs text-neutral-500">1개월 공제 {money(refundCase.monthlyDeductionKrw)}</p>
                    {refundCase.refundAction === "manual_amount" ? <p className="mt-1 text-xs text-amber-200">직접 입력</p> : null}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-bold">{paymentStatusLabels[refundCase.paymentStatus] || refundCase.paymentStatus}</p>
                    <p className="mt-1 break-all text-xs text-neutral-500">{refundCase.providerReference || "확인번호 없음"}</p>
                  </td>
                  <td className="max-w-72 px-4 py-4">
                    <p className="font-bold">{billingActionLabels[refundCase.billingAction]}</p>
                    <p className="mt-1 text-xs text-neutral-400">{entitlementActionLabels[refundCase.entitlementAction]}</p>
                    <p className="mt-1 text-xs text-neutral-600">{serviceStatusLabels[refundCase.serviceActionStatus] || refundCase.serviceActionStatus}{refundCase.entitlementEffectiveAt ? ` · ${date(refundCase.entitlementEffectiveAt)}` : ""}</p>
                  </td>
                  <td className="px-4 py-4 text-xs text-neutral-400">{refundCase.assignedAdminEmail || "-"}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => void copyGuide(refundCase)} className="rounded-lg border border-sky-300/20 px-3 py-2 text-xs font-black text-sky-100">안내 메일</button>
                      <button type="button" onClick={() => openEditor(refundCase)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">상세 관리</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!refundCases.length ? <tr><td colSpan={9} className="px-5 py-16 text-center text-neutral-500">조건에 맞는 환불 건이 없습니다.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {adding ? (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="refund-case-add-title">
          <div className="mx-auto my-6 w-full max-w-4xl rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">Refund case</p><h3 id="refund-case-add-title" className="mt-2 text-xl font-black">환불 건 추가</h3></div>
              <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-2 text-neutral-400">닫기</button>
            </div>
            <div className="mt-5 flex gap-2">
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchOrders(); } }} placeholder="사용자 이메일, 이름, 주문번호, PG 거래번호" className="h-11 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 outline-none" />
              <button type="button" disabled={searching || searchQuery.trim().length < 2} onClick={() => void searchOrders()} className="rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-40">{searching ? "검색 중" : "검색"}</button>
            </div>
            <div className="mt-4 max-h-64 overflow-y-auto rounded-2xl border border-white/10">
              {searchResults.map((order) => (
                <button key={order.id} type="button" disabled={Boolean(order.openCaseId) || order.status !== "succeeded"} onClick={() => selectOrder(order)} className={`flex w-full items-center justify-between gap-4 border-b border-white/[.06] p-4 text-left last:border-0 disabled:cursor-not-allowed disabled:opacity-40 ${selectedOrder?.id === order.id ? "bg-[#ff8c7c]/10" : "hover:bg-white/[.03]"}`}>
                  <div><p className="font-bold">{order.email}</p><p className="mt-1 text-xs text-neutral-500">{order.productName || order.orderName} · {order.orderId}</p></div>
                  <div className="text-right"><p className="font-black">{money(Number(order.amountKrw))}</p><p className="mt-1 text-xs text-neutral-500">{order.openCaseId ? "처리 중인 환불 건 있음" : order.status}</p></div>
                </button>
              ))}
              {!searchResults.length ? <p className="p-8 text-center text-sm text-neutral-500">검색 결과가 여기에 표시됩니다.</p> : null}
            </div>

            {selectedOrder ? (
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="font-black">환불 산정</h4>
                  <dl className="mt-4 grid grid-cols-[130px_1fr] gap-2 text-sm">
                    <dt className="text-neutral-500">결제금액</dt><dd className="text-right font-bold">{money(Number(selectedOrder.amountKrw))}</dd>
                    <dt className="text-neutral-500">첫 작업</dt><dd className="text-right font-bold">{selectedOrder.firstCompletedJobAt ? `완료 · ${date(selectedOrder.firstCompletedJobAt)}` : "완료 기록 없음"}</dd>
                    <dt className="text-neutral-500">1개월 공제</dt><dd className="text-right font-bold">{money(selectedQuote?.monthlyDeductionKrw || 0)}</dd>
                    <dt className="text-white">환불 예정액</dt><dd className="text-right text-lg font-black text-[#ffb4a8]">{money(selectedPlannedRefundKrw)}</dd>
                  </dl>
                </div>
                <div className="grid gap-4">
                  <label className="text-sm font-bold">환불 유형<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as AdminRefundReasonCode)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{adminRefundReasonCodes.map((code) => <option key={code} value={code}>{adminRefundReasonLabel(code)}</option>)}</select></label>
                  <label className="text-sm font-bold">환불 금액 방식<select value={refundAction} onChange={(event) => setRefundAction(event.target.value as AdminRefundAction)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{adminRefundActions.map((action) => <option key={action} value={action}>{action === "policy_refund" ? "첫 작업 기준 자동 계산" : action === "manual_amount" ? "금액 직접 입력" : "환불 없음"}</option>)}</select></label>
                  {refundAction === "manual_amount" ? <label className="text-sm font-bold">직접 입력 환불액<input type="number" min={1} max={Number(selectedOrder.amountKrw) - Number(selectedOrder.refundedAmountKrw)} value={manualRefundKrw} onChange={(event) => setManualRefundKrw(Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label> : null}
                </div>
                <label className="text-sm font-bold">자동결제 처리<select value={billingAction} onChange={(event) => setBillingAction(event.target.value as AdminRefundBillingAction)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{adminRefundBillingActions.map((action) => <option key={action} value={action} disabled={action !== "none" && (selectedOrder.provider !== "thepayone" || selectedOrder.billingCycle !== "monthly")}>{billingActionLabels[action]}</option>)}</select></label>
                <label className="text-sm font-bold">이용권 처리<select value={entitlementAction} onChange={(event) => setEntitlementAction(event.target.value as AdminRefundEntitlementAction)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{adminRefundEntitlementActions.map((action) => <option key={action} value={action}>{entitlementActionLabels[action]}</option>)}</select></label>
                <label className="text-sm font-bold lg:col-span-2">환불 사유<textarea required minLength={2} maxLength={1000} rows={3} value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3" /></label>
                <label className="text-sm font-bold lg:col-span-2">관리자 메모<textarea maxLength={2000} rows={2} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3" /></label>
                <p className="text-xs leading-5 text-amber-200 lg:col-span-2">{selectedOrder.provider === "toss" ? "이 단계에서는 환불 건만 등록합니다. 등록 후 상세 관리에서 실제 토스 카드 환불을 실행하세요." : "이 단계는 미처리 환불 건만 등록합니다. 카드 환불이나 구독·이용권 변경은 실행하지 않습니다."}</p>
                <button type="button" disabled={submitting || reasonDetail.trim().length < 2 || (refundAction === "manual_amount" && manualRefundKrw < 1)} onClick={() => void createCase()} className="h-12 rounded-xl bg-[#ff806f] font-black text-white disabled:opacity-40 lg:col-span-2">{submitting ? "등록 중..." : "미처리 환불 건 등록"}</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="refund-case-edit-title">
          <div className="mx-auto my-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">Refund case detail</p><h3 id="refund-case-edit-title" className="mt-2 text-xl font-black">환불 건 상세 관리</h3></div>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-neutral-400">닫기</button>
            </div>
            <dl className="mt-5 grid grid-cols-[130px_1fr] gap-2 rounded-2xl bg-black/20 p-4 text-sm">
              <dt className="text-neutral-500">고객</dt><dd className="font-bold">{editing.email}</dd>
              <dt className="text-neutral-500">주문</dt><dd className="break-all font-mono text-xs">{editing.orderId}</dd>
              <dt className="text-neutral-500">환불 예정액</dt><dd className="font-black text-[#ffb4a8]">{money(editing.plannedRefundKrw)}</dd>
              <dt className="text-neutral-500">자동결제</dt><dd>{billingActionLabels[editing.billingAction]}</dd>
              <dt className="text-neutral-500">이용권</dt><dd>{entitlementActionLabels[editing.entitlementAction]}{editing.entitlementEffectiveAt ? ` · ${date(editing.entitlementEffectiveAt)}` : ""}</dd>
            </dl>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold">업무 상태<select value={editingStatus} onChange={(event) => setEditingStatus(event.target.value as AdminRefundCaseStatus)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{adminRefundCaseStatuses.map((status) => <option key={status} value={status} disabled={editing.provider === "toss" && status === "completed" && editing.paymentStatus !== "completed"}>{caseStatusLabels[status]}</option>)}</select></label>
              {editing.provider === "toss" ? (
                <div className="text-sm font-bold">결제 환불 상태<div className="mt-2 flex h-11 items-center rounded-xl border border-white/10 bg-black/20 px-3 text-neutral-300">{paymentStatusLabels[editing.paymentStatus] || editing.paymentStatus}</div></div>
              ) : (
                <label className="text-sm font-bold">결제 환불 기록<select value={editingPaymentStatus} onChange={(event) => setEditingPaymentStatus(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3">{Object.entries(paymentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              )}
              {editing.provider === "toss" ? (
                <div className="text-sm font-bold sm:col-span-2">PG·카드사 확인번호<div className="mt-2 min-h-11 break-all rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-neutral-400">{editing.providerReference || "실제 환불 후 자동 기록됩니다."}</div></div>
              ) : (
                <label className="text-sm font-bold sm:col-span-2">PG·카드사 확인번호<input maxLength={200} value={editingProviderReference} onChange={(event) => setEditingProviderReference(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label>
              )}
              <label className="text-sm font-bold sm:col-span-2">관리자 메모<textarea maxLength={2000} rows={4} value={editingNote} onChange={(event) => setEditingNote(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3" /></label>
            </div>
            <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-300/[.06] p-4 text-xs font-bold leading-5 text-sky-100">{editing.provider === "toss" ? "토스 환불 상태와 확인번호는 실제 카드 환불 결과로만 자동 기록됩니다." : "업무 상태와 결제 환불 기록을 저장해도 더페이원 호출, 카드 환불, 결제금액 변경은 일어나지 않습니다."}</div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={submitting} onClick={() => void updateCase()} className="h-11 flex-1 rounded-xl bg-white px-4 text-sm font-black text-black disabled:opacity-40">{editing.provider === "toss" ? "업무 상태 저장" : "상태만 저장"}</button>
              <button type="button" onClick={() => void copyGuide(editing)} className="h-11 rounded-xl border border-sky-300/20 px-4 text-sm font-black text-sky-100">안내 메일 복사</button>
            </div>
            {editing.provider === "toss" ? (
              <div className="mt-5 border-t border-white/10 pt-5">
                <p className="text-sm font-black">토스 실제 카드 환불</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">환불 요청은 중복 실행되지 않도록 고정된 요청 번호로 처리됩니다.</p>
                <button type="button" disabled={submitting || editing.paymentStatus !== "not_started" || editing.plannedRefundKrw < 1} onClick={() => void executeTossPaymentRefund()} className="mt-3 h-11 rounded-xl bg-[#ff806f] px-4 text-sm font-black text-white disabled:opacity-40">{editing.paymentStatus === "completed" ? "토스 환불 완료" : editing.paymentStatus === "submitted" || editing.paymentStatus === "manual_review" ? "환불 결과 확인 필요" : "토스 카드 환불 실행"}</button>
              </div>
            ) : null}
            {(editing.billingAction !== "none" || editing.entitlementAction !== "none") ? (
              <div className="mt-5 border-t border-white/10 pt-5">
                <p className="text-sm font-black">구독·이용권 별도 실행</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">이 버튼은 선택된 자동결제 중지와 이용권 종료만 실행합니다. 카드 환불은 실행하지 않습니다.</p>
                <button type="button" disabled={submitting || editing.serviceActionStatus === "succeeded"} onClick={() => void executeServiceAction()} className="mt-3 h-11 rounded-xl border border-amber-300/25 px-4 text-sm font-black text-amber-100 disabled:opacity-40">{editing.serviceActionStatus === "succeeded" ? "구독·이용권 처리 완료" : "구독·이용권 처리 실행"}</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
