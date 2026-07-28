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
        select *
        from shorts_mvp.admin_refund_cases
        where id=${caseId}
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new HttpError(404, "환불 건을 찾을 수 없습니다.");

      const updated = await tx`
        update shorts_mvp.admin_refund_cases
        set status=${body.status},
          payment_status=${body.paymentStatus},
          provider_reference=${body.providerReference || null},
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
            paymentStatus: body.paymentStatus,
            providerReference: body.providerReference || null,
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
            paymentStatus: body.paymentStatus,
            providerReference: body.providerReference || null,
          })}
        )
      `;
      return updated;
    });

    // This endpoint intentionally updates only the operational case. It never
    // calls a payment provider or mutates billing_orders refund totals.
    return NextResponse.json({ ok: true, refundCase: rows[0] });
  } catch (error) {
    return apiError(error, "환불 건 상태를 변경하지 못했습니다.");
  }
}
