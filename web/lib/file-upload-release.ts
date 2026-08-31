import "server-only";

import type { Sql, TransactionSql } from "postgres";

export const FILE_UPLOAD_FLAG_KEY = "file_upload";
export const FILE_UPLOAD_PUBLIC_FLAG_KEY = "file_upload_public";
export const FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY =
  "file_upload_emergency_stop";

export type FileUploadReleaseAccess = {
  enabled: boolean;
  adminEnabled: boolean;
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  emergencyStopped: boolean;
  isAdmin: boolean;
};

export function fileUploadMasterEnabled() {
  return process.env.FILE_UPLOAD_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveFileUploadReleaseAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  emergencyStopped?: boolean;
  isAdmin: boolean;
}): FileUploadReleaseAccess {
  const emergencyStopped = input.emergencyStopped === true;
  const adminEnabled = input.masterEnabled
    && input.featureEnabled
    && !emergencyStopped
    && input.isAdmin;
  return {
    ...input,
    emergencyStopped,
    adminEnabled,
    enabled: input.masterEnabled
      && input.featureEnabled
      && !emergencyStopped
      && (input.isAdmin || input.publicEnabled),
  };
}

function disabledAccess() {
  return resolveFileUploadReleaseAccess({
    masterEnabled: false,
    featureEnabled: false,
    publicEnabled: false,
    emergencyStopped: false,
    isAdmin: false,
  });
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown }>,
) {
  const flags = new Map(
    flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]),
  );
  return resolveFileUploadReleaseAccess({
    masterEnabled: true,
    featureEnabled: flags.get(FILE_UPLOAD_FLAG_KEY) === true,
    publicEnabled: flags.get(FILE_UPLOAD_PUBLIC_FLAG_KEY) === true,
    emergencyStopped:
      flags.get(FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY) === true,
    isAdmin: adminRows[0]?.isAdmin === true,
  });
}

async function readFileUploadReleaseAccess(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
) {
  // The deployment switch is the outer ceiling. Keeping it off avoids even
  // consulting runtime state and makes a newly deployed control plane inert.
  if (!fileUploadMasterEnabled()) return disabledAccess();

  const flagRows = lock ? await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${FILE_UPLOAD_FLAG_KEY},${FILE_UPLOAD_PUBLIC_FLAG_KEY},
      ${FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY}
    )
    order by flag_key
    for share
  ` : await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${FILE_UPLOAD_FLAG_KEY},${FILE_UPLOAD_PUBLIC_FLAG_KEY},
      ${FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY}
    )
  `;
  const adminRows = !userId ? [] : lock ? await db`
    select is_admin
    from shorts_mvp.app_users
    where id=${userId}
    limit 1
    for share
  ` : await db`
    select is_admin
    from shorts_mvp.app_users
    where id=${userId}
    limit 1
  `;
  return accessFromRows(flagRows, adminRows);
}

export function getFileUploadReleaseAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return readFileUploadReleaseAccess(db, userId, false);
}

export function lockFileUploadReleaseAccess(
  db: TransactionSql,
  userId: string | null,
) {
  return readFileUploadReleaseAccess(db, userId, true);
}
