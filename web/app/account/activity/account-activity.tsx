"use client";

import { useCallback, useEffect, useState } from "react";

type ActivityResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: Array<Record<string, unknown>>;
  detail?: string;
};

function date(value: unknown) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(new Date(String(value)));
}
function money(value: unknown) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}
function minutes(value: unknown) {
  const seconds = Number(value || 0);
  const sign = seconds < 0 ? "−" : "+";
  return `${sign}${Math.ceil(Math.abs(seconds) / 60).toLocaleString("ko-KR")}분`;
}
const eventLabel: Record<string, string> = {
  plan_grant: "플랜 시간 지급", addon_grant: "추가시간 지급",
  upgrade_grant: "업그레이드 새 플랜 지급", upgrade_carryover: "업그레이드 잔여시간 이월",
  annual_or_monthly_grant: "월별 플랜 지급", source_consumed: "작업 사용",
  reservation_released: "작업 시간 복구",
};
const paymentStatusLabel: Record<string, string> = {
  pending: "결제 대기",
  processing: "결제 처리 중",
  succeeded: "결제 완료",
  failed: "결제 실패",
  unknown: "결과 확인 중",
  manual_review: "확인 필요",
  canceled: "결제 취소",
  expired: "요청 만료",
};

function billingCycleLabel(value: unknown) {
  if (value === "monthly") return "월간 구독";
  if (value === "yearly") return "기간 패키지";
  return "단건 결제";
}

function refundLabel(item: Record<string, unknown>) {
  const completed = Number(item.refundedAmountKrw || 0);
  const scheduled = Number(item.scheduledRefundAmountKrw || 0);
  if (scheduled > 0) return `환불 예정 ${money(scheduled)}`;
  if (completed > 0) return `환불 완료 ${money(completed)}`;
  return "환불 없음";
}

export function AccountActivity() {
  const [tab, setTab] = useState<"payments" | "usage">("payments");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityResponse>({ page: 1, pageSize: 25, total: 0, items: [] });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/account/activity?type=${tab}&page=${page}`, { cache: "no-store" });
    const result = await response.json() as ActivityResponse;
    if (!response.ok) setError(result.detail || "내역을 불러오지 못했습니다.");
    else { setData(result); setError(""); }
  }, [page, tab]);
  useEffect(() => { void load(); }, [load]);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-[#171a1b]">
      <div className="flex gap-2 border-b border-white/10 p-4">
        <button type="button" onClick={() => { setTab("payments"); setPage(1); }} className={`rounded-xl px-5 py-2.5 text-sm font-black ${tab === "payments" ? "bg-white text-black" : "text-neutral-400"}`}>내 결제 내역</button>
        <button type="button" onClick={() => { setTab("usage"); setPage(1); }} className={`rounded-xl px-5 py-2.5 text-sm font-black ${tab === "usage" ? "bg-white text-black" : "text-neutral-400"}`}>내 사용 내역</button>
      </div>
      {error && <p className="bg-red-400/10 px-5 py-3 text-sm text-red-200">{error}</p>}
      <div className="overflow-x-auto">
        {tab === "payments" ? <table className="w-full min-w-[1260px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[170px]" />
            <col className="w-[220px]" />
            <col className="w-[120px]" />
            <col className="w-[165px]" />
            <col className="w-[285px]" />
            <col className="w-[190px]" />
            <col className="w-[110px]" />
          </colgroup>
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="whitespace-nowrap px-5 py-3">결제일시</th><th className="whitespace-nowrap px-4 py-3">상품</th><th className="whitespace-nowrap px-4 py-3">금액 / 할부</th><th className="whitespace-nowrap px-4 py-3">상태 / 환불</th><th className="whitespace-nowrap px-4 py-3">주문번호</th><th className="whitespace-nowrap px-4 py-3">승인 / PG 거래</th><th className="whitespace-nowrap px-5 py-3">확인서</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">{data.items.map((item) => <tr key={String(item.id)}>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(item.approvedAt || item.createdAt)}</td>
            <td className="px-4 py-4"><p className="whitespace-nowrap font-bold">{String(item.orderName || item.productCode)}</p><p className="mt-1 whitespace-nowrap text-xs text-neutral-500">{billingCycleLabel(item.billingCycle)}</p></td>
            <td className="whitespace-nowrap px-4 py-4"><p className="font-black">{money(item.amountKrw)}</p><p className="mt-1 text-xs text-neutral-500">{Number(item.installmentMonths || 0) > 0 ? `${Number(item.installmentMonths)}개월 할부` : "일시불"}</p></td>
            <td className="whitespace-nowrap px-4 py-4"><p className="font-bold">{paymentStatusLabel[String(item.status)] || String(item.status)}</p><p className={`mt-1 text-xs ${Number(item.refundedAmountKrw || 0) > 0 || Number(item.scheduledRefundAmountKrw || 0) > 0 ? "text-[#ff9b8d]" : "text-neutral-600"}`}>{refundLabel(item)}</p></td>
            <td className="whitespace-nowrap px-4 py-4 font-mono text-[11px] tracking-[-.02em]">{String(item.orderId)}</td>
            <td className="whitespace-nowrap px-4 py-4 font-mono text-xs"><p>{String(item.providerAuthCode || "-")}</p><p className="mt-1 text-neutral-600">{String(item.providerTransactionId || "-")}</p></td>
            <td className="whitespace-nowrap px-5 py-4">{item.status === "succeeded" ? <a target="_blank" rel="noreferrer" href={`/api/account/receipts/${String(item.id)}`} className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-white/10 px-3 text-xs font-black transition hover:border-white/25 hover:bg-white/[.05]">결제확인서</a> : <span className="text-neutral-600">-</span>}</td>
          </tr>)}</tbody>
        </table> : <table className="w-full min-w-[960px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[180px]" />
            <col className="w-[190px]" />
            <col className="w-[390px]" />
            <col className="w-[100px]" />
            <col className="w-[140px]" />
          </colgroup>
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="whitespace-nowrap px-5 py-3">시각</th><th className="whitespace-nowrap px-4 py-3">구분</th><th className="whitespace-nowrap px-4 py-3">플랜 / 작업</th><th className="whitespace-nowrap px-4 py-3">시간</th><th className="whitespace-nowrap px-5 py-3">결과</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">{data.items.map((item) => <tr key={String(item.id)}>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(item.occurredAt)}</td>
            <td className="whitespace-nowrap px-4 py-4 font-bold">{eventLabel[String(item.eventType)] || String(item.eventType)}</td>
            <td className="px-4 py-4"><p>{item.projectNumber ? `프로젝트 #${String(item.projectNumber)}` : String(item.productCode || "-")}</p>{Boolean(item.videoTitle) && <p className="mt-1 max-w-md truncate text-xs text-neutral-500">{String(item.videoTitle)}</p>}</td>
            <td className={`whitespace-nowrap px-4 py-4 font-black ${Number(item.seconds || 0) < 0 ? "text-[#ff9b8d]" : "text-emerald-300"}`}>{minutes(item.seconds)}</td>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{String(item.result || "-")}</td>
          </tr>)}</tbody>
        </table>}
        {!data.items.length && <p className="px-5 py-16 text-center text-neutral-500">표시할 내역이 없습니다.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-white/10 p-4 text-sm">
        <span className="text-neutral-500">총 {data.total.toLocaleString("ko-KR")}건 · {page}/{pages}페이지</span>
        <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-30">이전</button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-30">다음</button></div>
      </div>
    </section>
  );
}
