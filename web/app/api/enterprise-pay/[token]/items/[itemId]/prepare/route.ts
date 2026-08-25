import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSameOriginJsonRequest,
  billingRequestOrigin,
} from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { tossGeneralPaymentKeys } from "@/lib/toss-general-payment-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string; itemId: string }>;
};

const paramsSchema = z.object({
  token: z.string().uuid(),
  itemId: z.string().uuid(),
});

function checkoutUrls(request: Request, token: string, attemptId: string) {
  const origin = billingRequestOrigin(request);
  const successUrl = new URL(
    `/enterprise-pay/${encodeURIComponent(token)}/success`,
    origin,
  );
  successUrl.searchParams.set("attemptId", attemptId);
  const failUrl = new URL(
    `/enterprise-pay/${encodeURIComponent(token)}/fail`,
    origin,
  );
  failUrl.searchParams.set("attemptId", attemptId);
  return { successUrl: successUrl.toString(), failUrl: failUrl.toString() };
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "결제 준비");
    const { token, itemId } = paramsSchema.parse(await params);
    const { clientKey } = tossGeneralPaymentKeys();
    const db = getDb();
    const rows = await db`
      select
        item.id,item.name,item.amount_krw,item.status,
        payment_request.customer_name,payment_request.customer_email,
        payment_request.status as request_status,payment_request.expires_at,
        managed.account_type
      from shorts_mvp.enterprise_payment_items item
      join shorts_mvp.enterprise_payment_requests payment_request
        on payment_request.id=item.payment_request_id
      join shorts_mvp.managed_login_accounts managed
        on managed.id=payment_request.managed_account_id
      where payment_request.public_token=${token}
        and item.id=${itemId}
      limit 1
    `;
    const item = rows[0];
    if (!item || item.accountType !== "enterprise") {
      throw new HttpError(404, "결제 항목을 찾을 수 없습니다.");
    }
    if (item.requestStatus === "canceled") {
      throw new HttpError(409, "취소된 결제 요청입니다.");
    }
    if (new Date(item.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(410, "결제 기한이 만료되었습니다.");
    }
    if (item.status === "paid") {
      throw new HttpError(409, "이미 결제가 완료된 항목입니다.");
    }
    if (item.status === "confirming" || item.status === "manual_review") {
      throw new HttpError(409, "이 결제의 승인 결과를 확인하고 있습니다. 다시 결제하지 마세요.");
    }

    const attempt = await db.begin(async (tx) => {
      const liveAttempts = await tx`
        select id,order_id,amount_krw,status,created_at
        from shorts_mvp.enterprise_payment_attempts
        where payment_item_id=${itemId}
          and status in ('prepared','confirming','manual_review')
        order by created_at desc
        limit 1
        for update
      `;
      const live = liveAttempts[0];
      if (live?.status === "confirming" || live?.status === "manual_review") {
        throw new HttpError(409, "이 결제의 승인 결과를 확인하고 있습니다. 다시 결제하지 마세요.");
      }
      if (live && new Date(live.createdAt).getTime() > Date.now() - 15 * 60_000) {
        return live;
      }
      if (live) {
        await tx`
          update shorts_mvp.enterprise_payment_attempts
          set status='failed',provider_error_code='PREPARE_EXPIRED',
            provider_error_message='결제 인증 유효시간이 지났습니다.'
          where id=${live.id} and status='prepared'
        `;
      }
      const orderId = `ent_${randomUUID().replaceAll("-", "")}`;
      const attempts = await tx`
        insert into shorts_mvp.enterprise_payment_attempts (
          payment_item_id,order_id,amount_krw
        ) values (${itemId},${orderId},${item.amountKrw})
        returning id,order_id,amount_krw,status,created_at
      `;
      return attempts[0];
    });
    const urls = checkoutUrls(request, token, attempt.id);
    return NextResponse.json({
      clientKey,
      attemptId: attempt.id,
      orderId: attempt.orderId,
      orderName: item.name,
      amount: Number(attempt.amountKrw),
      customerName: item.customerName,
      customerEmail: item.customerEmail || undefined,
      ...urls,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "결제를 준비하지 못했습니다.");
  }
}
