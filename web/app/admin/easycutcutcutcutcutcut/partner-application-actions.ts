"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { partnerApplicationStatuses } from "@/lib/partner-application";

const adminPath = "/admin/easycutcutcutcutcutcut";

const updateSchema = z.object({
  applicationId: z.uuid(),
  status: z.enum(partnerApplicationStatuses),
  adminNote: z.string().trim().max(1000),
});

export async function updatePartnerApplication(
  applicationId: string,
  formData: FormData,
): Promise<void> {
  const input = updateSchema.parse({
    applicationId,
    status: formData.get("status"),
    adminNote: formData.get("adminNote") || "",
  });
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const currentRows = await tx`
      select status,admin_note
      from shorts_mvp.partner_applications
      where id=${input.applicationId}
      for update
    `;
    const current = currentRows[0];
    if (!current) throw new HttpError(404, "파트너 신청을 찾을 수 없습니다.");
    if (current.status === input.status && (current.adminNote || "") === input.adminNote) return;

    await tx`
      update shorts_mvp.partner_applications
      set status=${input.status},admin_note=${input.adminNote || null},
        reviewed_by_user_id=${admin.id},reviewed_at=clock_timestamp()
      where id=${input.applicationId}
    `;
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},'partner_application.updated','partner_application',
        ${input.applicationId},
        ${tx.json({
          previousStatus: current.status,
          status: input.status,
          noteChanged: (current.adminNote || "") !== input.adminNote,
        })}
      )
    `;
  });

  revalidatePath(adminPath);
}
