"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG, CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG } from "@/lib/custom-template-design-access";
import { assertCustomTemplateDesignCanaryResults, assertCustomTemplateDesignRuntimeReady } from "@/lib/custom-template-design-admin";

export async function setCustomTemplateDesignMode(formData: FormData) {
  const admin = await requireAdminUser();
  const mode = z.enum(["off", "admin", "public"]).parse(formData.get("mode"));
  await getDb().begin(async (tx) => {
    // Recheck the actor inside the mutation transaction, including withdrawal
    // or an administrator revocation after the session was authenticated.
    const actors = await tx`
      select id from shorts_mvp.app_users
      where id=${admin.id} and is_admin and withdrawn_at is null for share
    `;
    if (actors.length !== 1) throw new HttpError(403, "관리자 권한이 필요합니다.");
    if (mode !== "off") {
      const releases = await assertCustomTemplateDesignRuntimeReady(tx, mode === "public");
      if (mode === "public") await assertCustomTemplateDesignCanaryResults(tx, releases);
    }
    const flags = await tx`
      select flag_key,enabled from shorts_mvp.runtime_feature_flags
      where flag_key in (${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG},${CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG})
      order by flag_key for update
    `;
    if (flags.length !== 2 && mode !== "off") throw new HttpError(409, "공개 설정 준비가 아직 반영되지 않았습니다.");
    await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=case when flag_key=${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG}
        then ${mode !== "off"} else ${mode === "public"} end,
        updated_by_user_id=${admin.id},updated_at=clock_timestamp()
      where flag_key in (${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG},${CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG})
    `;
    await tx`
      insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      values (${admin.id},'custom_template_design.mode_changed','runtime_feature','custom_template_design',
        ${tx.json({ mode, previous: flags.map((row) => ({ flag: String(row.flagKey), enabled: row.enabled === true })) })})
    `;
  });
  revalidatePath("/admin/easycutcutcutcutcutcut");
  revalidatePath("/templates");
  return { ok: true, mode, message: mode === "off" ? "신규 사용을 중지했습니다. 기존 영상과 보관 배경은 유지됩니다." : mode === "admin" ? "관리자 계정에서 테스트할 수 있습니다." : "일반 사용자에게 공개했습니다." };
}
