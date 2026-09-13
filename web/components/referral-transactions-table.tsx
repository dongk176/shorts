import { referralRecognitionReasonLabel, type ReferralSettlementTransaction } from "@/lib/referral-settlement";
import { referralMoney as money } from "./referral-settlement-table";

export function ReferralTransactionsTable({ transactions }: { transactions: ReferralSettlementTransaction[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm">
    <thead className="bg-black/20 text-xs text-neutral-400"><tr>
      {["발생일 / 회원", "원계약 / 유지 회차", "원결제 / 실제 환불", "원계약 회차 상한", "이번 회차 산정 매출", "수익률 / 회차 수익", "계약 전체 산정 / 제외", "상태"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}
    </tr></thead>
    <tbody className="divide-y divide-white/10">{transactions.map(item => <tr key={item.id}>
      <td className="px-4 py-4"><p>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(new Date(item.earnedAt))}</p><p className="mt-1 text-xs text-neutral-400">{item.memberEmail}</p></td>
      <td className="px-4 py-4"><p>{item.originalProductCode ?? item.productCode}</p><p className="mt-1 text-xs">원계약 {item.originalContractMonths || "미확인"}개월 · 유지 {item.eligibleInstallmentCount ?? item.installmentCount}회</p><p className="mt-1 text-xs text-neutral-400">현재 {item.installmentNumber}/{item.installmentCount}회차</p></td>
      <td className="px-4 py-4"><p>{money(item.grossAmountKrw)}</p><p className="mt-1 text-xs text-rose-300">환불 {money(item.refundedAmountKrw)}</p></td>
      <td className="px-4 py-4">{money(item.installmentGrossAmountKrw)}</td>
      <td className="px-4 py-4">{money(item.recognizedAmountKrw)}</td>
      <td className="px-4 py-4"><p>{item.commissionRateBps / 100}%</p><strong className="text-emerald-200">{money(item.commissionAmountKrw)}</strong></td>
      <td className="px-4 py-4"><p>{money(item.commissionBasisKrw ?? 0)}</p><p className="mt-1 text-xs text-neutral-400">레퍼럴 제외 {money(item.excludedSalesKrw ?? 0)}</p></td>
      <td className="max-w-64 px-4 py-4 text-xs">{item.recognitionStatus === "review_required"
        ? <span className="text-amber-200">정산 보류 · {referralRecognitionReasonLabel(item.recognitionReason)}</span>
        : item.installmentNumber > (item.eligibleInstallmentCount ?? item.installmentCount)
          ? "종료된 회차"
          : item.paidAmountKrw > 0 ? `지급 완료 ${money(item.paidAmountKrw)}`
            : item.draftAmountKrw > 0 ? "송금 준비" : item.isAvailable ? "지급 대상" : `${item.scheduledPaymentDate} 지급 예정`}</td>
    </tr>)}</tbody>
  </table>{!transactions.length && <p className="p-8 text-center text-sm text-neutral-400">이 기간의 수익 거래가 없습니다.</p>}</div>;
}
