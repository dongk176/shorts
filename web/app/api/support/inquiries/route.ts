import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import {
  SUPPORT_INQUIRY_MAX_PER_HOUR,
  supportInquirySubmissionSchema,
} from "@/lib/support-inquiry";

export const dynamic = "force-dynamic";

type InquiryRow = {
  id: string;
  createdAt: Date | string;
};

function inquiryResponse(row: InquiryRow, status = 201) {
  return NextResponse.json({
    submitted: true,
    inquiryId: row.id,
    referenceCode: `EC-${row.id.slice(0, 8).toUpperCase()}`,
    createdAt: row.createdAt,
  }, { status });
}

export async function POST(request: Request) {
  try {
    const input = supportInquirySubmissionSchema.parse(await request.json());
    const session = await requireMvpSession(undefined, {
      enforcePaymentMethodRemediation: true,
    });
    if (input.inquiryKind === "refund_request" && !session.userId) {
      throw new HttpError(401, "결제 내역을 확인하려면 로그인이 필요합니다.", "AUTH_REQUIRED");
    }
    const db = getDb();
    const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512) || null;

    const result = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended(${`support-inquiry:${session.id}`},0)
        )
      `;

      const existingRows = await tx`
        select id,created_at
        from shorts_mvp.customer_inquiries
        where request_id=${input.requestId}
          and mvp_session_id=${session.id}
        limit 1
      `;
      if (existingRows[0]) {
        return { row: existingRows[0] as InquiryRow, existing: true };
      }

      const recentRows = await tx`
        select count(*)::int as count
        from shorts_mvp.customer_inquiries
        where mvp_session_id=${session.id}
          and created_at >= clock_timestamp() - interval '1 hour'
      `;
      if (Number(recentRows[0]?.count || 0) >= SUPPORT_INQUIRY_MAX_PER_HOUR) {
        throw new HttpError(
          429,
          "문의가 너무 많이 접수되었습니다. 잠시 후 다시 시도해 주세요.",
          "SUPPORT_INQUIRY_RATE_LIMIT",
          3600,
        );
      }

      if (input.inquiryKind === "refund_request") {
        await tx`
          select pg_advisory_xact_lock(
            hashtextextended(${`refund-inquiry:${input.billingOrderId}`},0)
          )
        `;
        const orderRows = await tx`
          select o.id,
            (
              o.amount_krw
              - greatest(
                o.refunded_amount_krw,
                coalesce((
                  select sum(r.amount_krw)
                  from shorts_mvp.admin_billing_refunds r
                  where r.billing_order_id=o.id
                    and r.status in ('pending','processing','succeeded','manual_review')
                ),0)
                + coalesce((
                  select sum(r.refund_amount_krw)
                  from shorts_mvp.subscription_upgrade_refunds r
                  where r.source_order_id=o.id
                    and r.status in ('pending','submitted','completed','manual_review')
                ),0)
              )
            )::integer as remaining_refundable_amount_krw,
            exists (
              select 1 from shorts_mvp.customer_inquiries i
              where i.billing_order_id=o.id
                and i.inquiry_kind='refund_request'
                and i.status in ('new','in_progress','waiting_on_customer')
            ) as has_open_refund_inquiry
          from shorts_mvp.billing_orders o
          where o.id=${input.billingOrderId}
            and o.user_id=${session.userId}
            and o.status='succeeded'
          limit 1
        `;
        const order = orderRows[0];
        if (!order || Number(order.remainingRefundableAmountKrw || 0) <= 0) {
          throw new HttpError(
            409,
            "환불 요청 가능한 결제를 찾을 수 없습니다.",
            "REFUND_ORDER_NOT_AVAILABLE",
          );
        }
        if (order.hasOpenRefundInquiry) {
          throw new HttpError(
            409,
            "이미 접수되어 확인 중인 환불 요청이 있습니다.",
            "REFUND_INQUIRY_ALREADY_OPEN",
          );
        }
      }

      const insertedRows = await tx`
        insert into shorts_mvp.customer_inquiries (
          request_id,mvp_session_id,user_id,category,contact_email,
          message,locale,page_path,user_agent,inquiry_kind,billing_order_id,
          refund_reason_code
        ) values (
          ${input.requestId},${session.id},${session.userId},${input.category},
          ${input.contactEmail},${input.message},${input.locale},${input.pagePath},
          ${userAgent},${input.inquiryKind},${input.billingOrderId},
          ${input.refundReasonCode}
        )
        returning id,created_at
      `;
      return { row: insertedRows[0] as InquiryRow, existing: false };
    });

    const response = inquiryResponse(result.row, result.existing ? 200 : 201);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error, "문의를 접수하지 못했습니다.");
  }
}
