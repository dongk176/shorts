import { NextRequest } from "next/server";
import { requirePartnerSession } from "@/lib/partner-auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { maskedReferralEmail } from "@/lib/referral-policy";

function validDate(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function kstDate(daysFromToday: number) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + daysFromToday * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requirePartnerSession();
    const from = validDate(request.nextUrl.searchParams.get("from"), kstDate(-29));
    const to = validDate(request.nextUrl.searchParams.get("to"), kstDate(0));
    const rows = await getDb()`
      select orders.approved_at,account.email,orders.product_code,
        commission.gross_amount_krw,commission.refunded_amount_krw,
        commission.commission_rate_bps,
        installment.installment_number,installment.installment_count,
        installment.gross_amount_krw as installment_gross_amount_krw,
        installment.recognized_amount_krw,installment.commission_amount_krw,
        installment.earned_at,installment.available_at,
        coalesce(allocation.draft_amount_krw,0)::bigint as draft_amount_krw,
        coalesce(allocation.paid_amount_krw,0)::bigint as paid_amount_krw
      from shorts_mvp.referral_commission_installments installment
      join shorts_mvp.referral_commissions commission
        on commission.id=installment.commission_id
      join shorts_mvp.billing_orders orders on orders.id=commission.billing_order_id
      left join shorts_mvp.app_users account on account.id=commission.user_id
      left join lateral (
        select
          sum(item.amount_krw) filter (where payout.status='draft')::bigint
            as draft_amount_krw,
          sum(item.amount_krw) filter (where payout.status='paid')::bigint
            as paid_amount_krw
        from shorts_mvp.referral_payout_items item
        join shorts_mvp.referral_payouts payout on payout.id=item.payout_id
        where item.installment_id=installment.id
      ) allocation on true
      where commission.partner_id=${session.partnerId}
        and installment.earned_at>=${from}::date at time zone 'Asia/Seoul'
        and installment.earned_at<(${to}::date+1) at time zone 'Asia/Seoul'
      order by installment.earned_at desc,orders.approved_at desc
    `;
    const header = [
      "수익발생일","원결제일","회원","상품","회차","전체회차",
      "총결제금액","총환불금액","회차기준금액","환불반영기준금액",
      "수익률","월별수익금액","상태","정산가능일",
    ];
    const lines = rows.map((row) => [
      row.earnedAt instanceof Date ? row.earnedAt.toISOString() : row.earnedAt,
      row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
      maskedReferralEmail(row.email),
      row.productCode,
      Number(row.installmentNumber),
      Number(row.installmentCount),
      Number(row.grossAmountKrw),
      Number(row.refundedAmountKrw),
      Number(row.installmentGrossAmountKrw),
      Number(row.recognizedAmountKrw),
      `${(Number(row.commissionRateBps) / 100).toFixed(2)}%`,
      Number(row.commissionAmountKrw),
      Number(row.paidAmountKrw) > 0
        ? "지급 완료"
        : Number(row.draftAmountKrw) > 0
          ? "정산 초안 포함"
          : new Date(String(row.availableAt)).getTime() <= Date.now()
            ? "정산 가능"
            : "7일 대기 또는 향후 예정",
      row.availableAt instanceof Date ? row.availableAt.toISOString() : row.availableAt,
    ].map(csvCell).join(","));
    const csv = `\uFEFF${header.map(csvCell).join(",")}\r\n${lines.join("\r\n")}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="easycut-referral-${from}-${to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "CSV를 생성하지 못했습니다.");
  }
}
