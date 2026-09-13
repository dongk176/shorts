import type { ReactNode } from "react";
import { referralSettlementStatusLabels, referralRecognitionReasonLabel, type ReferralMonthlySettlement } from "@/lib/referral-settlement";

export function referralMoney(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function ReferralSettlementTable({ rows, showPartner = false }: {
  rows: Array<{ key: string; partnerName?: string; settlement: ReferralMonthlySettlement; actions?: ReactNode }>;
  showPartner?: boolean;
}) {
  return <div className="overflow-x-auto rounded-2xl border border-white/10">
    <table className="w-full min-w-[1120px] text-left text-sm">
      <thead className="bg-black/20 text-xs text-neutral-400"><tr>
        {showPartner && <th className="px-4 py-3">파트너</th>}
        {["실적 기간", "지급 예정일", "확정 매출 · 정산 기준", "대기 / 예정 매출", "레퍼럴 수익", "이전 지급분 환불 조정", "지급 대상액", "상태 / 관리"].map((label) =>
          <th key={label} className="px-4 py-3">{label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-white/10">
        {rows.map(({ key, partnerName, settlement: row, actions }) => <tr key={key}>
          {showPartner && <td className="px-4 py-4 font-bold">{partnerName}</td>}
          <td className="px-4 py-4"><strong>{row.month}</strong><p className="mt-1 text-xs text-neutral-400">{row.periodStart} ~ {row.periodEnd}</p></td>
          <td className="px-4 py-4 font-bold">{row.scheduledPaymentDate}</td>
          <td className="px-4 py-4">{referralMoney(row.confirmedSalesKrw)}{Boolean(row.excludedSalesKrw) && <p className="mt-1 text-xs text-neutral-400">레퍼럴 제외 {referralMoney(row.excludedSalesKrw ?? 0)}</p>}</td>
          <td className="px-4 py-4 text-xs"><p>7일 대기 {referralMoney(row.waitingSalesKrw)}</p><p className="mt-1 text-neutral-400">발생 예정 {referralMoney(row.futureSalesKrw)}</p></td>
          <td className="px-4 py-4">{referralMoney(row.commissionKrw)}</td>
          <td className="px-4 py-4 text-rose-300">{row.refundAdjustmentKrw ? `−${referralMoney(row.refundAdjustmentKrw)}` : "—"}</td>
          <td className="px-4 py-4 font-black text-emerald-200">{referralMoney(row.payableKrw)}{row.status === "accruing" && <p className="mt-1 text-xs font-normal text-neutral-400">현재 예상</p>}</td>
          <td className="px-4 py-4"><strong>{referralSettlementStatusLabels[row.status]}</strong>
            {Boolean(row.reviewCount) && <p className="mt-2 max-w-64 text-xs text-amber-200">확인 필요 {row.reviewCount}건 · {(row.reviewReasons ?? []).map(referralRecognitionReasonLabel).join(" / ")}</p>}
            {Boolean(row.unallocatedRefundDebtKrw) && <p className="mt-2 text-xs text-rose-300">다음 정산 차감 잔액 {referralMoney(row.unallocatedRefundDebtKrw ?? 0)}</p>}
            {row.overdue && <span className="ml-2 text-xs text-amber-200">지급 지연</span>}
            {row.paidAt && <p className="mt-1 text-xs text-neutral-400">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(row.paidAt))} 지급 처리</p>}
            {row.draftChanged && <p className="mt-2 max-w-64 text-xs text-amber-200">준비 후 환불 조정이 변경됐습니다. 현재 재계산액 {referralMoney(row.currentPayableKrw)}. 아직 송금하지 않았다면 취소 후 다시 준비해 주세요.</p>}
            {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={showPartner ? 9 : 8} className="px-4 py-10 text-center text-neutral-400">이 실적 월의 정산 내역이 없습니다.</td></tr>}
      </tbody>
    </table>
  </div>;
}
