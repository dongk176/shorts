import { NextRequest } from "next/server";
import { requirePartnerSession } from "@/lib/partner-auth";
import { apiError, HttpError } from "@/lib/http";
import { defaultReferralMonth, resolveSettlementMonth, referralSettlementStatusLabels } from "@/lib/referral-settlement";
import { loadReferralSettlementReport } from "@/lib/referral-settlement-server";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '\"\"')}"`;
}
export async function GET(request: NextRequest) {
  try {
    const session = await requirePartnerSession();
    const params = request.nextUrl.searchParams;
    let month: string;
    try {
      month = params.has("month") || params.has("from") || params.has("to")
        ? resolveSettlementMonth({ settlementMonth: params.get("month") ?? undefined,
          periodStart: params.get("from") ?? undefined, periodEnd: params.get("to") ?? undefined })
        : defaultReferralMonth();
    } catch { throw new HttpError(400, "실적 월 또는 월초~월말 기간을 선택해 주세요."); }
    const now = new Date();
    const { months, transactions } = await loadReferralSettlementReport(session.partnerId, month, now);
    const summary = months.find((row) => row.month === month);
    if (!summary) throw new HttpError(404, "정산 내역을 찾을 수 없습니다.");
    const header = ["행구분","실적월","지급예정일","수익발생일","원결제일","회원","상품","회차","전체회차",
      "총결제금액","총환불금액","회차기준금액","환불반영기준금액","수익률","월별수익금액","상태",
      "월확정매출","월대기매출","월예정매출","월수익합계","이전지급분환불조정","월지급대상액"];
    const rows: unknown[][] = transactions.map((item) => [
      "회차",month,item.scheduledPaymentDate,item.earnedAt,item.approvedAt,item.memberEmail,item.productCode,
      item.installmentNumber,item.installmentCount,item.grossAmountKrw,item.refundedAmountKrw,
      item.installmentGrossAmountKrw,item.recognizedAmountKrw,`${item.commissionRateBps / 100}%`,
      item.commissionAmountKrw,referralSettlementStatusLabels[summary.status],"","","","","","",
    ]);
    rows.push(["월정산",month,summary.scheduledPaymentDate,"","","","","","","","","","","","",
      referralSettlementStatusLabels[summary.status],summary.confirmedSalesKrw,summary.waitingSalesKrw,
      summary.futureSalesKrw,summary.commissionKrw,summary.refundAdjustmentKrw,summary.payableKrw]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="easycut-referral-${month}.csv"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) { return apiError(error, "CSV를 생성하지 못했습니다."); }
}
