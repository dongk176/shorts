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
      select o.approved_at,u.email,o.product_code,c.gross_amount_krw,
        c.refunded_amount_krw,c.commission_rate_bps,c.commission_amount_krw,c.available_at
      from shorts_mvp.referral_commissions c
      join shorts_mvp.billing_orders o on o.id=c.billing_order_id
      left join shorts_mvp.app_users u on u.id=c.user_id
      where c.partner_id=${session.partnerId}
        and o.approved_at>=${from}::date at time zone 'Asia/Seoul'
        and o.approved_at<(${to}::date+1) at time zone 'Asia/Seoul'
      order by o.approved_at desc
    `;
    const header = [
      "결제일","회원","상품","결제금액","환불금액","수익률","수익금액","정산가능일",
    ];
    const lines = rows.map((row) => [
      row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
      maskedReferralEmail(row.email),
      row.productCode,
      Number(row.grossAmountKrw),
      Number(row.refundedAmountKrw),
      `${(Number(row.commissionRateBps) / 100).toFixed(2)}%`,
      Number(row.commissionAmountKrw),
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
