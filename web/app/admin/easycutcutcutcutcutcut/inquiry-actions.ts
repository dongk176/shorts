"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

const adminPath = "/admin/easycutcutcutcutcutcut";

export async function resolveAdminInquiry(
  inquiryId: string,
): Promise<void> {
  if (!z.string().uuid().safeParse(inquiryId).success) {
    throw new HttpError(400, "문의 번호가 올바르지 않습니다.");
  }

  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const currentRows = await tx`
      select status
      from shorts_mvp.customer_inquiries
      where id=${inquiryId}
      for update
    `;
    const current = currentRows[0];
    if (!current) throw new HttpError(404, "문의를 찾을 수 없습니다.");
    if (current.status === "resolved" || current.status === "closed") return;

    await tx`
      update shorts_mvp.customer_inquiries
      set status='resolved',resolved_at=clock_timestamp()
      where id=${inquiryId}
    `;
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},'customer_inquiry.resolved','customer_inquiry',${inquiryId},
        ${tx.json({
          previousStatus: current.status,
          status: "resolved",
        })}
      )
    `;
  });

  revalidatePath(adminPath);
}
