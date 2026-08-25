import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  assertSameOriginJsonRequest,
  billingRequestOrigin,
} from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { tossGeneralPaymentKeys } from "@/lib/toss-general-payment-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ accountId: string }> };

const schema = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().trim().min(1).max(100),
  customerEmail: z.union([z.string().trim().email().max(100), z.literal("")])
    .optional(),
  title: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime({ offset: true }),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    amountKrw: z.number().int().min(100).max(1_000_000_000),
  }).strict()).min(1).max(10),
}).strict();

function paymentUrl(request: Request, token: string) {
  return new URL(`/enterprise-pay/${encodeURIComponent(token)}`, billingRequestOrigin(request))
    .toString();
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "결제 요청 생성");
    const [{ accountId }, admin, input] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => schema.parse(value)),
    ]);
    tossGeneralPaymentKeys();
    const expiresAt = new Date(input.expiresAt);
    const now = Date.now();
    if (expiresAt.getTime() <= now + 5 * 60_000) {
      throw new HttpError(400, "결제 기한은 현재보다 5분 이상 이후여야 합니다.");
    }
    if (expiresAt.getTime() > now + 180 * 24 * 60 * 60_000) {
      throw new HttpError(400, "결제 기한은 180일 이내로 설정해 주세요.");
    }

    const db = getDb();
    const duplicate = await db`
      select id,public_token
      from shorts_mvp.enterprise_payment_requests
      where create_request_id=${input.requestId}
      limit 1
    `;
    if (duplicate[0]) {
      return NextResponse.json({
        ok: true,
        requestId: duplicate[0].id,
        paymentUrl: paymentUrl(request, duplicate[0].publicToken),
        alreadyProcessed: true,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const accounts = await db`
      select id,login_id,account_type
      from shorts_mvp.managed_login_accounts
      where id=${accountId}
      limit 1
    `;
    const account = accounts[0];
    if (!account) throw new HttpError(404, "발급 계정을 찾을 수 없습니다.");
    if (account.accountType !== "enterprise") {
      throw new HttpError(409, "기업 계정에만 결제를 요청할 수 있습니다.");
    }

    const totalAmountKrw = input.items.reduce((sum, item) => sum + item.amountKrw, 0);
    const created = await db.begin(async (tx) => {
      const requests = await tx`
        insert into shorts_mvp.enterprise_payment_requests (
          create_request_id,managed_account_id,customer_name,customer_email,
          title,expires_at,created_by_user_id
        ) values (
          ${input.requestId},${accountId},${input.customerName},
          ${input.customerEmail || null},${input.title},${expiresAt},${admin.id}
        )
        returning id,public_token
      `;
      const paymentRequest = requests[0];
      for (const [index, item] of input.items.entries()) {
        await tx`
          insert into shorts_mvp.enterprise_payment_items (
            payment_request_id,sort_order,name,amount_krw
          ) values (
            ${paymentRequest.id},${index + 1},${item.name},${item.amountKrw}
          )
        `;
      }
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'enterprise_payment_request.created',
          'enterprise_payment_request',${paymentRequest.id},
          ${tx.json({
            managedAccountId: accountId,
            loginId: account.loginId,
            itemCount: input.items.length,
            totalAmountKrw,
            expiresAt: expiresAt.toISOString(),
          })}
        )
      `;
      return paymentRequest;
    });

    return NextResponse.json({
      ok: true,
      requestId: created.id,
      paymentUrl: paymentUrl(request, created.publicToken),
      alreadyProcessed: false,
    }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error, "결제 요청을 만들지 못했습니다.");
  }
}
