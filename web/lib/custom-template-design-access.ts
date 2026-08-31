import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";

export const CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG = "custom_template_design_enabled";
export const CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG = "custom_template_design_public";

export type CustomTemplateDesignAccess = {
  enabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  adminEnabled: boolean;
};

export function resolveCustomTemplateDesignAccess(input: {
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
}): CustomTemplateDesignAccess {
  return {
    ...input,
    enabled: input.featureEnabled && (input.isAdmin || input.publicEnabled),
    adminEnabled: input.featureEnabled && input.isAdmin,
  };
}

async function readAccess(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
): Promise<CustomTemplateDesignAccess> {
  const disabled = resolveCustomTemplateDesignAccess({
    featureEnabled: false, publicEnabled: false, isAdmin: false,
  });
  if (!userId) return disabled;
  // Missing seed rows are OFF. No deployment environment variable or new
  // credential is needed to expose the administrator canary.
  const flagRows = lock ? await db`
    select flag_key,enabled from shorts_mvp.runtime_feature_flags
    where flag_key in (${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG},${CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG})
    order by flag_key for share
  ` : await db`
    select flag_key,enabled from shorts_mvp.runtime_feature_flags
    where flag_key in (${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG},${CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG})
  `;
  const flags = new Map(flagRows.map((row) => [String(row.flagKey), row.enabled === true]));
  if (!flags.has(CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG)
    || !flags.has(CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG)) return disabled;
  const userRows = lock ? await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} and withdrawn_at is null limit 1 for share
  ` : await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} and withdrawn_at is null limit 1
  `;
  if (!userRows[0]) return disabled;
  return resolveCustomTemplateDesignAccess({
    featureEnabled: flags.get(CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG) === true,
    publicEnabled: flags.get(CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG) === true,
    isAdmin: userRows[0].isAdmin === true,
  });
}

export function getCustomTemplateDesignAccess(db: Sql | TransactionSql, userId: string | null) {
  return readAccess(db, userId, false);
}

export function lockCustomTemplateDesignAccess(db: TransactionSql, userId: string | null) {
  return readAccess(db, userId, true);
}

export function assertCustomTemplateDesignAccess(access: Pick<CustomTemplateDesignAccess, "enabled">) {
  if (!access.enabled) {
    throw new HttpError(
      403,
      "내 배경과 템플릿 텍스트 기능은 아직 사용할 수 없습니다.",
      "CUSTOM_TEMPLATE_DESIGN_DISABLED",
    );
  }
}
