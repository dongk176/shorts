"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  LOGIN_WELCOME_GRANT_FLAG_KEY,
  onboardingWelcomeGrantEnabled,
} from "@/lib/onboarding-welcome";

const adminPath = "/admin/easycutcutcutcutcutcut";
const enabledSchema = z.boolean();

export type FreeUsageGrantSettingResult = {
  enabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: string;
};

export async function updateFreeUsageGrantSetting(
  requestedEnabled: boolean,
): Promise<FreeUsageGrantSettingResult> {
  const enabled = enabledSchema.parse(requestedEnabled);
  const admin = await requireAdminUser();
  const result = await getDb().begin(async (tx) => {
    const currentRows = await tx`
      select enabled,updated_at
      from shorts_mvp.runtime_feature_flags
      where flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
      for update
    `;
    const current = currentRows[0];
    if (!current) {
      throw new HttpError(503, "무료 사용량 운영 설정을 찾을 수 없습니다.");
    }
    if (Boolean(current.enabled) === enabled) {
      return {
        enabled,
        updatedAt: new Date(current.updatedAt).toISOString(),
      };
    }

    const updatedRows = await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=${enabled},updated_by_user_id=${admin.id}
      where flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
      returning enabled,updated_at
    `;
    const updated = updatedRows[0];
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},
        'runtime_feature_flag.changed',
        'runtime_feature_flag',
        ${LOGIN_WELCOME_GRANT_FLAG_KEY},
        ${tx.json({
          previousEnabled: Boolean(current.enabled),
          enabled,
        })}
      )
    `;
    return {
      enabled: Boolean(updated.enabled),
      updatedAt: new Date(updated.updatedAt).toISOString(),
    };
  });

  revalidatePath(adminPath);
  return {
    ...result,
    effectiveEnabled: result.enabled && onboardingWelcomeGrantEnabled(),
  };
}
