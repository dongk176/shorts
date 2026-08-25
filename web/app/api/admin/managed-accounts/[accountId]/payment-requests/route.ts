import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  assertSameOriginJsonRequest,
  billingRequestOrigin,
} from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { insertEnterpriseBillingRequest } from "@/lib/enterprise-billing";
import { enterprisePaymentItemSchema } from "@/lib/enterprise-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ accountId: string }> };

const schema = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().trim().min(1).max(100),
  customerEmail: z.union([z.string().trim().email().max(100), z.literal("")])
    .optional(),
  title: z.string().trim().min(1).max(100),
  blocksServiceAccess: z.boolean().default(false),
  items: z.array(enterprisePaymentItemSchema).min(1).max(10),
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
      select id,login_id,account_type,app_user_id
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
      const paymentRequest = await insertEnterpriseBillingRequest({
        db: tx,
        createRequestId: input.requestId,
        managedAccountId: accountId,
        appUserId: account.appUserId,
        createdByUserId: admin.id,
        customerName: input.customerName,
        customerEmail: input.customerEmail || null,
        title: input.title,
        blocksServiceAccess: input.blocksServiceAccess,
        items: input.items,
      });
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
            expiresAt: paymentRequest.expiresAt.toISOString(),
            paymentMode: "billing",
            blocksServiceAccess: input.blocksServiceAccess,
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
