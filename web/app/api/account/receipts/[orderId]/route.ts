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
function seoulDate(value: unknown, includeTime = false) {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    ...(includeTime ? { timeStyle: "medium" as const } : {}),
    timeZone: "Asia/Seoul",
  }).format(parsed);
}
function externalHttpsUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await context.params;
    const id = z.string().uuid().parse(orderId);
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select * from shorts_mvp.billing_orders
      where id=${id} and user_id=${session.userId} and status='succeeded' and amount_krw > 0
      limit 1
    `;
    const personalOrder = rows[0];
    const enterpriseRows = !personalOrder && session.isEnterprise === true
      ? await db`
          select item.id,item.name,item.amount_krw,item.service_start_date,
            item.service_end_date,item.included_minutes,item.vat_treatment,
            payment_request.title as request_title,
            payment_attempt.order_id,payment_attempt.approved_at,
            payment_attempt.payment_method,payment_attempt.receipt_url
          from shorts_mvp.enterprise_payment_items item
          join shorts_mvp.enterprise_payment_requests payment_request
            on payment_request.id=item.payment_request_id
          join shorts_mvp.managed_login_accounts managed
            on managed.id=payment_request.managed_account_id
          join shorts_mvp.enterprise_payment_attempts payment_attempt
            on payment_attempt.id=item.paid_attempt_id
          where item.id=${id} and item.status='paid'
            and managed.app_user_id=${session.userId}
            and managed.account_type='enterprise' and managed.is_active=true
          limit 1
        `
      : [];
    const enterpriseOrder = enterpriseRows[0];
    if (!personalOrder && !enterpriseOrder) {
      throw new HttpError(404, "결제확인서를 찾을 수 없습니다.");
    }
    const approvedAt = seoulDate(
      enterpriseOrder?.approvedAt || personalOrder?.approvedAt,
      true,
    );
    const providerReceiptUrl = externalHttpsUrl(enterpriseOrder?.receiptUrl);
    const enterpriseDetails = enterpriseOrder
      ? `<tr><th>결제 요청</th><td>${escapeHtml(enterpriseOrder.requestTitle)}</td></tr>
      <tr><th>서비스 이용기간</th><td>${escapeHtml(seoulDate(enterpriseOrder.serviceStartDate))} ~ ${escapeHtml(seoulDate(enterpriseOrder.serviceEndDate))}</td></tr>
      <tr><th>제공 처리시간</th><td>${escapeHtml(Number(enterpriseOrder.includedMinutes || 0).toLocaleString("ko-KR"))}분</td></tr>
      <tr><th>부가세</th><td>${enterpriseOrder.vatTreatment === "not_applicable" ? "부가세 해당 없음" : "부가세 포함"}</td></tr>`
      : "";
    const providerReceipt = providerReceiptUrl
      ? `<tr><th>카드 매출전표</th><td><a href="${escapeHtml(providerReceiptUrl)}" target="_blank" rel="noopener noreferrer">토스 결제 매출전표 열기</a></td></tr>`
      : "";
    const displayedOrderId = enterpriseOrder?.orderId || personalOrder?.orderId;
    const displayedOrderName = enterpriseOrder?.name || personalOrder?.orderName;
    const displayedAmount = enterpriseOrder?.amountKrw || personalOrder?.amountKrw;
    const refundPolicyPath = enterpriseOrder ? "/enterprise/refund-policy" : "/refund";
    const paymentMethod = enterpriseOrder?.paymentMethod
      || (Number(personalOrder?.installmentMonths || 0) > 0
        ? `${Number(personalOrder?.installmentMonths)}개월 할부`
        : "일시불");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Easy Cut 결제확인서</title><style>
      body{font-family:system-ui,sans-serif;color:#181818;max-width:760px;margin:40px auto;padding:0 24px}
      h1{font-size:28px}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{border:1px solid #ddd;padding:12px;text-align:left}th{width:180px;background:#f6f6f6}
      .notice{background:#fff5f2;padding:16px;border-radius:10px}.actions{margin:24px 0}@media print{.actions{display:none}}
    </style></head><body><h1>Easy Cut 결제확인서</h1><p>이지컷 서비스 결제 사실을 확인하는 내부 문서입니다.</p>
    <table>
      <tr><th>주문번호</th><td>${escapeHtml(displayedOrderId)}</td></tr>
      <tr><th>거래일시</th><td>${escapeHtml(approvedAt)}</td></tr>
      <tr><th>승인번호</th><td>${escapeHtml(personalOrder?.providerAuthCode || "-")}</td></tr>
      <tr><th>상품</th><td>${escapeHtml(displayedOrderName)}</td></tr>
      <tr><th>결제금액</th><td>${money(displayedAmount)}</td></tr>
      ${enterpriseDetails}
      <tr><th>환불금액</th><td>${money(personalOrder?.refundedAmountKrw)}</td></tr>
      <tr><th>환불정책</th><td><a href="${refundPolicyPath}" target="_blank" rel="noopener noreferrer">환불정책</a></td></tr>
      <tr><th>결제 방식</th><td>${escapeHtml(paymentMethod)}</td></tr>
      <tr><th>PG 거래번호</th><td>${escapeHtml(personalOrder?.providerTransactionId || "-")}</td></tr>
      ${providerReceipt}
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
