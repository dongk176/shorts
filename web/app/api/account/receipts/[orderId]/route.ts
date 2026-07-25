import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}
function money(value: unknown) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await context.params;
    const id = z.string().uuid().parse(orderId);
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select * from shorts_mvp.billing_orders
      where id=${id} and user_id=${session.userId} and status='succeeded' and amount_krw > 0
      limit 1
    `;
    const order = rows[0];
    if (!order) throw new HttpError(404, "결제확인서를 찾을 수 없습니다.");
    const approvedAt = order.approvedAt instanceof Date
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "medium", timeZone: "Asia/Seoul" }).format(order.approvedAt)
      : "-";
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Easy Cut 결제확인서</title><style>
      body{font-family:system-ui,sans-serif;color:#181818;max-width:760px;margin:40px auto;padding:0 24px}
      h1{font-size:28px}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{border:1px solid #ddd;padding:12px;text-align:left}th{width:180px;background:#f6f6f6}
      .notice{background:#fff5f2;padding:16px;border-radius:10px}.actions{margin:24px 0}@media print{.actions{display:none}}
    </style></head><body><h1>Easy Cut 결제확인서</h1><p>이지컷 서비스 결제 사실을 확인하는 내부 문서입니다.</p>
    <table>
      <tr><th>주문번호</th><td>${escapeHtml(order.orderId)}</td></tr>
      <tr><th>거래일시</th><td>${escapeHtml(approvedAt)}</td></tr>
      <tr><th>승인번호</th><td>${escapeHtml(order.providerAuthCode || "-")}</td></tr>
      <tr><th>상품</th><td>${escapeHtml(order.orderName)}</td></tr>
      <tr><th>결제금액</th><td>${money(order.amountKrw)}</td></tr>
      <tr><th>환불금액</th><td>${money(order.refundedAmountKrw)}</td></tr>
      <tr><th>결제 방식</th><td>${Number(order.installmentMonths || 0) > 0 ? `${Number(order.installmentMonths)}개월 할부` : "일시불"}</td></tr>
      <tr><th>PG 거래번호</th><td>${escapeHtml(order.providerTransactionId || "-")}</td></tr>
      <tr><th>사업자정보</th><td>아티룸 · 대표 김동민 · 사업자등록번호 638-04-03590 · 통신판매업 2025-서울마포-2971 · 서울특별시 마포구 성산로8길 40</td></tr>
    </table>
    <p class="notice">본 문서는 공식 카드 매출전표 또는 세금계산서가 아닌 Easy Cut 내부 결제확인서입니다.</p>
    <div class="actions"><button onclick="window.print()">인쇄</button></div></body></html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "결제확인서를 열지 못했습니다.");
  }
}
