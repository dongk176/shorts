import type { Sql, TransactionSql } from "postgres";

export const SUBTITLE_TEMPLATES_FLAG_KEY = "subtitle_templates";
export const SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY = "subtitle_templates_public";

export type SubtitleTemplateAccess = {
  enabled: boolean;
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
};

function masterSwitchEnabled() {
  return process.env.SUBTITLE_TEMPLATES_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveSubtitleTemplateAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
}): SubtitleTemplateAccess {
  return {
    ...input,
    enabled: input.masterEnabled
      && input.featureEnabled
      && (input.publicEnabled || input.isAdmin),
  };
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown }>,
) {
  const flags = new Map(
    flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]),
  );
  return resolveSubtitleTemplateAccess({
    masterEnabled: masterSwitchEnabled(),
    featureEnabled: flags.get(SUBTITLE_TEMPLATES_FLAG_KEY) === true,
    publicEnabled: flags.get(SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY) === true,
    isAdmin: adminRows[0]?.isAdmin === true,
  });
}

async function readAccess(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
) {
  if (!masterSwitchEnabled()) {
    return resolveSubtitleTemplateAccess({
      masterEnabled: false,
      featureEnabled: false,
      publicEnabled: false,
      isAdmin: false,
    });
  }
  const flagRows = lock ? await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY}
    )
    for share
  ` : await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY}
    )
  `;
  const adminRows = !userId ? [] : lock ? await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} limit 1 for share
  ` : await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} limit 1
  `;
  return accessFromRows(flagRows, adminRows);
}

export function getSubtitleTemplateAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, false);
}

export function lockSubtitleTemplateAccess(
  db: TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, true);
}
