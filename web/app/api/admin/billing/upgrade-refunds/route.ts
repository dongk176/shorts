import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["submitted", "completed", "manual_review"]),
  providerReference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict();

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function filters(request: Request) {
  const url = new URL(request.url);
  const status = ["pending", "submitted", "completed", "manual_review"].includes(
    url.searchParams.get("status") || "",
  ) ? url.searchParams.get("status")! : "all";
  return {
    status,
    query: (url.searchParams.get("q") || "").trim().slice(0, 100),
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || "",
    csv: url.searchParams.get("format") === "csv",
  };
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const input = filters(request);
    const db = getDb();
    const rows = await db`
      select r.*,u.email,u.display_name,source.order_id as source_order_number,
        upgrade.order_id as upgrade_order_number,upgrade.provider_transaction_id as upgrade_provider_transaction_id
      from shorts_mvp.subscription_upgrade_refunds r
      join shorts_mvp.app_users u on u.id=r.user_id
      join shorts_mvp.billing_orders source on source.id=r.source_order_id
      join shorts_mvp.billing_orders upgrade on upgrade.id=r.upgrade_order_id
      where (${input.status}='all' or r.status=${input.status})
        and (${input.from}='' or r.created_at >= ${input.from || "1900-01-01"}::date)
        and (${input.to}='' or r.created_at < (${input.to || "2999-12-31"}::date + interval '1 day'))
        and (
          ${input.query}=''
          or lower(coalesce(u.email,'')) like ${`%${input.query.toLowerCase()}%`}
          or lower(coalesce(u.display_name,'')) like ${`%${input.query.toLowerCase()}%`}
          or u.id::text=${input.query}
          or lower(source.order_id) like ${`%${input.query.toLowerCase()}%`}
          or lower(upgrade.order_id) like ${`%${input.query.toLowerCase()}%`}
        )
      order by
        case r.status when 'pending' then 0 when 'manual_review' then 1 when 'submitted' then 2 else 3 end,
        r.created_at
      limit ${input.csv ? 5000 : 250}
    `;
    if (!input.csv) return NextResponse.json({ refunds: rows });

    const headers = [
      "사용자명", "이메일", "사용자ID", "이전 플랜", "신규 플랜", "신규 주기",
      "거래일자", "승인번호", "전체 결제금액", "부분취소 금액", "원주문번호",
      "업그레이드 주문번호", "PG 원거래번호", "카드사", "끝 4자리", "상태", "PG 확인번호", "메모",
    ];
    const keys = [
      "displayName", "email", "userId", "sourcePlanCode", "targetPlanCode", "targetBillingCycle",
      "sourceTransactionDay", "sourceAuthCode", "sourceAmountKrw", "refundAmountKrw", "sourceOrderNumber",
      "upgradeOrderNumber", "sourceProviderTransactionId", "cardIssuer", "cardLast4", "status",
      "providerReference", "adminNote",
    ];
    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")),
    ].join("\r\n");
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="easy-cut-upgrade-refunds.csv"`,
      },
    });
  } catch (error) {
    return apiError(error, "업그레이드 부분환불 원장을 불러오지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    const body = updateSchema.parse(await request.json());
    const db = getDb();
    const rows = await db.begin(async (tx) => {
      const currentRows = await tx`
        select * from shorts_mvp.subscription_upgrade_refunds where id=${body.id} for update
      `;
      const current = currentRows[0];
      if (!current) throw new HttpError(404, "부분환불 항목을 찾을 수 없습니다.");
      if (current.status === "completed") {
        if (body.action === "completed") return currentRows;
        throw new HttpError(409, "이미 환불 완료된 항목은 되돌릴 수 없습니다.");
      }
      if (body.action === "submitted" && !["pending", "manual_review"].includes(current.status)) {
        throw new HttpError(409, "PG 전달 완료로 변경할 수 없는 상태입니다.");
      }
      if (body.action === "completed" && !["submitted", "manual_review"].includes(current.status)) {
        throw new HttpError(409, "PG 전달 완료 또는 확인 필요 상태에서만 환불 완료로 변경할 수 있습니다.");
      }
      const updated = await tx`
        update shorts_mvp.subscription_upgrade_refunds
        set status=${body.action},
          submitted_by_user_id=case when ${body.action}='submitted' then ${admin.id} else submitted_by_user_id end,
          submitted_at=case when ${body.action}='submitted' then now() else submitted_at end,
          completed_by_user_id=case when ${body.action}='completed' then ${admin.id} else completed_by_user_id end,
          completed_at=case when ${body.action}='completed' then now() else completed_at end,
          provider_reference=coalesce(${body.providerReference || null},provider_reference),
          admin_note=coalesce(${body.note ?? null},admin_note)
        where id=${body.id}
        returning *
      `;
      if (body.action === "completed") await tx`
        update shorts_mvp.billing_orders
        set refunded_amount_krw=refunded_amount_krw+${Number(current.refundAmountKrw)},
          refund_status=case
            when refunded_amount_krw+${Number(current.refundAmountKrw)} >= amount_krw then 'full'
            else 'partial'
          end,
          proration_refund_status='succeeded'
        where id=${current.sourceOrderId}
          and proration_refund_status in ('pending','manual_review')
      `;
      if (body.action === "manual_review") await tx`
        update shorts_mvp.billing_orders set proration_refund_status='manual_review'
        where id=${current.sourceOrderId} and proration_refund_status='pending'
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},${`billing.upgrade_refund_${body.action}`},'subscription_upgrade_refund',${body.id},
          ${tx.json({ providerReference: body.providerReference || null, note: body.note || "" })}
        )
      `;
      return updated;
    });
    return NextResponse.json({ ok: true, refund: rows[0] });
  } catch (error) {
    return apiError(error, "업그레이드 부분환불 상태를 변경하지 못했습니다.");
  }
}
