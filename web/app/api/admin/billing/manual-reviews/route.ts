import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { isPricingV2PackageCode } from "@/lib/pricing-v2";
import {
  assertThePayOneBillingEnabled,
  thePayOneCredentialScopeForMerchantTerminal,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.literal("no_approval"),
  requestId: z.string().uuid(),
  orderId: z.string().uuid(),
  note: z.string().trim().min(2).max(400),
  confirmation: z.literal("PG 승인 없음 확인"),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const db = getDb();
    const result = await db.begin(async (tx) => {
      const orders = await tx`
        select * from shorts_mvp.billing_orders
        where id=${body.orderId}
        for update
      `;
      const order = orders[0];
      if (!order) throw new HttpError(404, "확인할 결제 주문을 찾을 수 없습니다.");
      if (
        order.provider !== "thepayone"
        || (
          order.kind !== "addon"
          && !isPricingV2PackageCode(String(order.productCode))
        )
      ) {
        throw new HttpError(
          409,
          "패키지·추가시간 더페이원 수기결제 주문만 이 화면에서 처리할 수 있습니다.",
        );
      }
      const credentialScope = thePayOneCredentialScopeForMerchantTerminal(
        String(order.providerMerchantId),
        String(order.providerTerminalId),
      );
      if (credentialScope !== "manual") {
        throw new HttpError(409, "arti02 수기결제 주문이 아닙니다.");
      }
      const grants = await tx`
        select count(*)::integer as grant_count
        from shorts_mvp.usage_grants
        where billing_order_id=${order.id}
      `;
      if (Number(grants[0]?.grantCount || 0) > 0) {
        throw new HttpError(
          409,
          "이 주문에 연결된 권한이 있어 결과 불명 전용 처리로 종결할 수 없습니다.",
        );
      }
      if (order.refundStatus !== "none") {
        throw new HttpError(
          409,
          "이 주문은 이미 취소 처리 중이거나 취소 결과 대조가 필요합니다.",
        );
      }
      if (
        order.status === "failed"
        && order.failureCode === "MANUAL_REVIEW_NO_APPROVAL"
      ) {
        return { alreadyProcessed: true };
      }
      if (!["manual_review", "unknown"].includes(String(order.status))) {
        throw new HttpError(409, "PG 대조가 필요한 주문 상태가 아닙니다.");
      }

      await tx`
        update shorts_mvp.billing_orders
        set status='failed',provider_status='no_approval',
          failure_code='MANUAL_REVIEW_NO_APPROVAL',
          failure_message='PG 관리자에서 승인 없음 확인'
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='failed',provider_code='MANUAL_REVIEW_NO_APPROVAL',
          finished_at=coalesce(finished_at,now())
        where order_id=${order.id} and status in ('processing','unknown')
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.manual_review_no_approval','billing_order',${order.id},
          ${tx.json({
            requestId: body.requestId,
            note: body.note,
            previousStatus: order.status,
            amountKrw: Number(order.amountKrw),
            recordedProviderTransactionId: order.providerTransactionId || null,
            providerTerminalId: order.providerTerminalId,
          })}
        )
      `;
      return { alreadyProcessed: false };
    });

    return NextResponse.json({
      ok: true,
      action: "no_approval",
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    return apiError(error, "결제 확인 결과를 처리하지 못했습니다.");
  }
}
