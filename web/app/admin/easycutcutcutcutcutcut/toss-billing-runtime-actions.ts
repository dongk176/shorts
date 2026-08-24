"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  tossBillingChargesEnabled,
  tossBillingCohortAssignmentEnabled,
  tossBillingRenewalsEnabled,
} from "@/lib/toss-billing-config";
import {
  isTossRuntimeFlag,
  loadTossBillingRuntimeState,
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_FLAGS,
  TOSS_RUNTIME_HANA_CARD_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
  type TossBillingRuntimeState,
} from "@/lib/toss-billing-runtime";

const adminPath = "/admin/easycutcutcutcutcutcut";
const inputSchema = z.object({
  flag: z.string().refine(isTossRuntimeFlag),
  enabled: z.boolean(),
}).strict();

export async function updateTossBillingRuntimeSetting(input: {
  flag: string;
  enabled: boolean;
}): Promise<TossBillingRuntimeState> {
  const parsed = inputSchema.parse(input);
  const admin = await requireAdminUser();
  const state = await getDb().begin(async (tx) => {
    const rows = await tx`
      select flag_key,enabled
      from shorts_mvp.runtime_feature_flags
      where flag_key in (
        ${TOSS_RUNTIME_ASSIGNMENTS_FLAG},
        ${TOSS_RUNTIME_CHARGES_FLAG},
        ${TOSS_RUNTIME_RENEWALS_FLAG},
        ${TOSS_RUNTIME_HANA_CARD_FLAG}
      )
      for update
    `;
    if (rows.length !== TOSS_RUNTIME_FLAGS.length) {
      throw new HttpError(503, "토스 결제 운영 스위치 마이그레이션이 필요합니다.");
    }
    const previous = Object.fromEntries(
      rows.map((row) => [String(row.flagKey), Boolean(row.enabled)]),
    );
    if (parsed.enabled) {
      if (parsed.flag === TOSS_RUNTIME_CHARGES_FLAG && !tossBillingChargesEnabled()) {
        throw new HttpError(409, "배포 환경에서 토스 승인이 강제 중단되어 있습니다.");
      }
      if (
        parsed.flag === TOSS_RUNTIME_ASSIGNMENTS_FLAG
        && (!tossBillingCohortAssignmentEnabled() || !previous[TOSS_RUNTIME_CHARGES_FLAG])
      ) {
        throw new HttpError(409, "신규 배정 전에 배포 설정과 토스 승인을 먼저 켜야 합니다.");
      }
      if (
        parsed.flag === TOSS_RUNTIME_RENEWALS_FLAG
        && (!tossBillingRenewalsEnabled() || !previous[TOSS_RUNTIME_CHARGES_FLAG])
      ) {
        throw new HttpError(409, "자동갱신 전에 배포 설정과 토스 승인을 먼저 켜야 합니다.");
      }
    }

    if (parsed.flag === TOSS_RUNTIME_CHARGES_FLAG && !parsed.enabled) {
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=false,updated_by_user_id=${admin.id}
        where flag_key in (
          ${TOSS_RUNTIME_ASSIGNMENTS_FLAG},
          ${TOSS_RUNTIME_CHARGES_FLAG},
          ${TOSS_RUNTIME_RENEWALS_FLAG}
        )
      `;
    } else {
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=${parsed.enabled},updated_by_user_id=${admin.id}
        where flag_key=${parsed.flag}
      `;
    }
    const current = await loadTossBillingRuntimeState(tx);
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},'toss_billing.runtime_flags_changed','runtime_feature_flag',
        ${parsed.flag},${tx.json({
          requestedEnabled: parsed.enabled,
          previous,
          current: current.stored,
        })}
      )
    `;
    return current;
  });
  revalidatePath(adminPath);
  return state;
}
