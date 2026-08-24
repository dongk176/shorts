import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { adminRefundCaseStatuses } from "@/lib/admin-refund-case";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

const schema = z.object({
  status: z.enum(adminRefundCaseStatuses),
  paymentStatus: z.enum([
    "not_started",
    "submitted",
    "completed",
    "failed",
    "manual_review",
  ]),
  providerReference: z.string().trim().max(200).optional(),
  adminNote: z.string().trim().max(2000).optional(),
}).strict();

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    assertBillingMutationRequest(request);
    const [{ caseId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => schema.parse(value)),
    ]);
    if (!z.string().uuid().safeParse(caseId).success) {
      throw new HttpError(400, "환불 건 번호가 올바르지 않습니다.");
    }
    const db = getDb();
    const rows = await db.begin(async (tx) => {
      const currentRows = await tx`
        select c.*,o.provider
        from shorts_mvp.admin_refund_cases c
        join shorts_mvp.billing_orders o on o.id=c.billing_order_id
        where c.id=${caseId}
        for update of c,o
      `;
      const current = currentRows[0];
      if (!current) throw new HttpError(404, "환불 건을 찾을 수 없습니다.");

      if (current.provider === "toss") {
        const suppliedReference = body.providerReference || null;
        const storedReference = current.providerReference || null;
        if (
          body.paymentStatus !== current.paymentStatus
          || suppliedReference !== storedReference
        ) {
          throw new HttpError(
            409,
            "토스 환불 상태와 확인번호는 실제 카드 환불 결과로만 변경할 수 있습니다.",
          );
        }
        if (
          body.status === "completed"
          && (
            current.paymentStatus !== "completed"
            || (
              (current.billingAction !== "none" || current.entitlementAction !== "none")
              && current.serviceActionStatus !== "succeeded"
            )
          )
        ) {
          throw new HttpError(409, "실제 환불과 선택한 이용권 처리를 먼저 완료해 주세요.");
        }
      }

      const paymentStatus = current.provider === "toss"
        ? current.paymentStatus
        : body.paymentStatus;
      const providerReference = current.provider === "toss"
        ? current.providerReference || null
        : body.providerReference || null;

      const updated = await tx`
        update shorts_mvp.admin_refund_cases
        set status=${body.status},
          payment_status=${paymentStatus},
          provider_reference=${providerReference},
          admin_note=${body.adminNote || null},
          assigned_to_user_id=${admin.id},
          completed_at=case
            when ${body.status}='completed' then coalesce(completed_at,now())
            else null
          end,
          closed_at=case
            when ${body.status}='closed' then coalesce(closed_at,now())
            else null
          end
        where id=${caseId}
        returning *
      `;
      await tx`
        insert into shorts_mvp.admin_refund_case_events (
          refund_case_id,actor_user_id,event_type,from_status,to_status,note,metadata
        ) values (
          ${caseId},${admin.id},'refund_case.status_changed',
          ${current.status},${body.status},${body.adminNote || null},
          ${tx.json({
            previousPaymentStatus: current.paymentStatus,
            paymentStatus,
            providerReference,
            provider: current.provider,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'refund_case.status_changed','admin_refund_case',${caseId},
          ${tx.json({
            previousStatus: current.status,
            status: body.status,
            previousPaymentStatus: current.paymentStatus,
            paymentStatus,
            providerReference,
            provider: current.provider,
          })}
        )
      `;
      return updated;
    });

    // This endpoint intentionally updates only the operational case. Toss
    // payment fields are immutable here and can only be changed by the
    // provider-backed payment-action endpoint.
    return NextResponse.json({ ok: true, refundCase: rows[0] });
  } catch (error) {
    return apiError(error, "환불 건 상태를 변경하지 못했습니다.");
  }
}
