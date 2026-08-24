import type { Sql, TransactionSql } from "postgres";

export const SOURCE_RANGE_FLAG_KEY = "source_range_selection";
export const SOURCE_RANGE_PUBLIC_FLAG_KEY = "source_range_selection_public";

export type SourceRangeReleaseAccess = {
  enabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
};

function masterSwitchEnabled() {
  return process.env.SOURCE_RANGE_SELECTION_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveSourceRangeReleaseAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
}): SourceRangeReleaseAccess {
  const enabled = input.masterEnabled
    && input.featureEnabled
    && (input.publicEnabled || input.isAdmin);
  return { ...input, enabled };
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown }>,
) {
  const flags = new Map(flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]));
  return resolveSourceRangeReleaseAccess({
    masterEnabled: masterSwitchEnabled(),
    featureEnabled: flags.get(SOURCE_RANGE_FLAG_KEY) === true,
    publicEnabled: flags.get(SOURCE_RANGE_PUBLIC_FLAG_KEY) === true,
    isAdmin: adminRows[0]?.isAdmin === true,
  });
}

export async function getSourceRangeReleaseAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  const flagRows = await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (${SOURCE_RANGE_FLAG_KEY},${SOURCE_RANGE_PUBLIC_FLAG_KEY})
  `;
  const adminRows = userId ? await db`
    select is_admin
    from shorts_mvp.app_users
    where id=${userId}
    limit 1
  ` : [];
  return accessFromRows(flagRows, adminRows);
}

export async function lockSourceRangeReleaseAccess(
  db: TransactionSql,
  userId: string | null,
) {
  const flagRows = await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (${SOURCE_RANGE_FLAG_KEY},${SOURCE_RANGE_PUBLIC_FLAG_KEY})
    for share
  `;
  const adminRows = userId ? await db`
    select is_admin
    from shorts_mvp.app_users
    where id=${userId}
    limit 1
    for share
  ` : [];
  return accessFromRows(flagRows, adminRows);
}
