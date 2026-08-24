import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { executeRecordedTossCancellation } from "@/lib/toss-billing-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

const schema = z.object({
  confirmation: z.literal("토스 환불 실행"),
}).strict();

type PreparedRefund = {
  alreadyDone: boolean;
  userId: string;
  rootTransactionId: string;
  cancellationProviderOrderId: string;
  idempotencyKey: string;
  cancelAmountKrw: number;
  cancelReason: string;
};

function cancellationProviderOrderId(caseId: string) {
  return `TOSS-CANCEL-${caseId.replaceAll("-", "")}`;
}

export async function POST(request: Request, { params }: RouteContext) {
  let refundCaseId: string | null = null;
  let adminId: string | null = null;
  let providerActionAttempted = false;
  try {
    assertBillingMutationRequest(request);
    const [{ caseId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => schema.parse(value)),
    ]);
    void body;
    if (!z.string().uuid().safeParse(caseId).success) {
      throw new HttpError(400, "환불 건 번호가 올바르지 않습니다.");
    }
    refundCaseId = caseId;
    adminId = admin.id;
    const db = getDb();
    const prepared = await db.begin(async (tx): Promise<PreparedRefund> => {
      const caseRows = await tx`
        select c.*,o.provider,o.user_id,o.order_id,o.amount_krw,
          o.refunded_amount_krw,o.status as order_status
        from shorts_mvp.admin_refund_cases c
        join shorts_mvp.billing_orders o on o.id=c.billing_order_id
        where c.id=${caseId}
        for update of c,o
      `;
      const refundCase = caseRows[0];
      if (!refundCase) throw new HttpError(404, "환불 건을 찾을 수 없습니다.");
      if (refundCase.provider !== "toss") {
        throw new HttpError(409, "토스 결제 주문만 여기서 실제 카드 환불을 실행할 수 있습니다.");
      }
      if (refundCase.paymentStatus === "completed") {
        return {
          alreadyDone: true,
          userId: String(refundCase.userId),
          rootTransactionId: "",
          cancellationProviderOrderId: String(refundCase.providerReference || ""),
          idempotencyKey: `refund-case-${caseId}`,
          cancelAmountKrw: Number(refundCase.plannedRefundKrw),
          cancelReason: refundCase.reasonDetail,
        };
      }
      if (["submitted", "manual_review"].includes(refundCase.paymentStatus)) {
        throw new HttpError(409, "이미 접수된 환불 결과를 상점관리자에서 먼저 확인해 주세요.");
      }
      const cancelAmountKrw = Number(refundCase.plannedRefundKrw);
      if (!Number.isSafeInteger(cancelAmountKrw) || cancelAmountKrw < 1) {
        throw new HttpError(409, "실행할 환불 금액이 없습니다.");
      }
      const remainingAmountKrw = Math.max(
        0,
        Number(refundCase.amountKrw) - Number(refundCase.refundedAmountKrw || 0),
      );
      if (cancelAmountKrw > remainingAmountKrw) {
        throw new HttpError(409, "남은 환불 가능 금액을 초과했습니다.");
      }
      const paymentRows = await tx`
        select id,provider_order_id,status,amount_krw,canceled_amount_krw
        from shorts_mvp.billing_toss_transactions
        where billing_order_id=${refundCase.billingOrderId}
          and user_id=${refundCase.userId}
          and transaction_type='payment'
        order by requested_at desc
        limit 1
        for update
      `;
      const payment = paymentRows[0];
      if (!payment || !["succeeded", "partial_canceled"].includes(payment.status)) {
        throw new HttpError(409, "환불할 토스 승인 거래를 확인할 수 없습니다.");
      }
      await tx`
        update shorts_mvp.admin_refund_cases
        set status='in_progress',payment_status='submitted',
          assigned_to_user_id=${admin.id}
        where id=${caseId}
      `;
      await tx`
        insert into shorts_mvp.admin_refund_case_events (
          refund_case_id,actor_user_id,event_type,from_status,to_status,note,metadata
        ) values (
          ${caseId},${admin.id},'refund_case.toss_refund_requested',
          ${refundCase.status},'in_progress','토스 실제 카드 환불을 요청함',
          ${tx.json({
            billingOrderId: refundCase.billingOrderId,
            rootTransactionId: payment.id,
            cancelAmountKrw,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'refund_case.toss_refund_requested',
          'admin_refund_case',${caseId},
          ${tx.json({
            billingOrderId: refundCase.billingOrderId,
            rootTransactionId: payment.id,
            cancelAmountKrw,
          })}
        )
      `;
      return {
        alreadyDone: false,
        userId: String(refundCase.userId),
        rootTransactionId: String(payment.id),
        cancellationProviderOrderId: cancellationProviderOrderId(caseId),
        idempotencyKey: `refund-case-${caseId}`,
        cancelAmountKrw,
        cancelReason: String(refundCase.reasonDetail || "고객 환불"),
      };
    });

    if (prepared.alreadyDone) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    providerActionAttempted = true;
    const result = await executeRecordedTossCancellation({
      db,
      userId: prepared.userId,
      rootTransactionId: prepared.rootTransactionId,
      providerOrderId: prepared.cancellationProviderOrderId,
      idempotencyKey: prepared.idempotencyKey,
      cancelAmountKrw: prepared.cancelAmountKrw,
      cancelReason: prepared.cancelReason.slice(0, 200),
    });
    const succeeded = result.state === "succeeded" || result.state === "already_succeeded";
    const providerReference = result.transaction.id;
    const updatedRows = await db.begin(async (tx) => {
      const lockedRows = await tx`
        select *
        from shorts_mvp.admin_refund_cases
        where id=${caseId}
        for update
      `;
      const current = lockedRows[0];
      if (!current) throw new HttpError(404, "환불 건을 찾을 수 없습니다.");
      const serviceDone = (
        current.billingAction === "none"
        && current.entitlementAction === "none"
      ) || current.serviceActionStatus === "succeeded";
      const status = succeeded && serviceDone ? "completed" : succeeded ? "in_progress" : "manual_review";
      const paymentStatus = succeeded ? "completed" : "manual_review";
      const updated = await tx`
        update shorts_mvp.admin_refund_cases
        set status=${status},payment_status=${paymentStatus},
          provider_reference=${providerReference},
          completed_at=case when ${status}='completed' then coalesce(completed_at,now()) else null end
        where id=${caseId}
        returning *
      `;
      await tx`
        insert into shorts_mvp.admin_refund_case_events (
          refund_case_id,actor_user_id,event_type,from_status,to_status,note,metadata
        ) values (
          ${caseId},${admin.id},
          ${succeeded ? "refund_case.toss_refund_succeeded" : "refund_case.toss_refund_requires_review"},
          ${current.status},${status},
          ${succeeded ? "토스 실제 카드 환불을 완료함" : "토스 환불 결과를 직접 확인해야 함"},
          ${tx.json({
            cancellationTransactionId: providerReference,
            cancellationState: result.state,
            cancelAmountKrw: prepared.cancelAmountKrw,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},
          ${succeeded ? "refund_case.toss_refund_succeeded" : "refund_case.toss_refund_requires_review"},
          'admin_refund_case',${caseId},
          ${tx.json({
            cancellationTransactionId: providerReference,
            cancellationState: result.state,
            cancelAmountKrw: prepared.cancelAmountKrw,
          })}
        )
      `;
      return updated;
    });
    return NextResponse.json({
      ok: succeeded,
      state: result.state,
      providerReference,
      refundCase: updatedRows[0],
    }, { status: succeeded ? 200 : 202 });
  } catch (error) {
    if (refundCaseId && adminId && providerActionAttempted) {
      await getDb().begin(async (tx) => {
        const updated = await tx`
          update shorts_mvp.admin_refund_cases
          set status='manual_review',payment_status='manual_review'
          where id=${refundCaseId} and payment_status='submitted'
          returning id
        `;
        if (!updated[0]) return;
        await tx`
          insert into shorts_mvp.admin_refund_case_events (
            refund_case_id,actor_user_id,event_type,note,metadata
          ) values (
            ${refundCaseId},${adminId},'refund_case.toss_refund_requires_review',
            ${error instanceof Error ? error.message.slice(0, 500) : "처리 실패"},
            ${tx.json({ providerActionAttempted: true })}
          )
        `;
        await tx`
          insert into shorts_mvp.admin_audit_logs (
            actor_user_id,action,entity_type,entity_id,metadata
          ) values (
            ${adminId},'refund_case.toss_refund_requires_review',
            'admin_refund_case',${refundCaseId},
            ${tx.json({ providerActionAttempted: true })}
          )
        `;
      }).catch(() => undefined);
    }
    return apiError(error, "토스 카드 환불을 완료하지 못했습니다.");
  }
}
