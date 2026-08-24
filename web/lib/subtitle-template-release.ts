import type { Sql, TransactionSql } from "postgres";
import {
  resolveEditorRelease,
  subtitleEditingReleaseEnabled,
} from "@/lib/editor-rendering-release";

export const SUBTITLE_TEMPLATES_FLAG_KEY = "subtitle_templates";
export const SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY = "subtitle_templates_public";
export const UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY =
  "unified_template_subtitles_canary";

export type SubtitleTemplateAccess = {
  enabled: boolean;
  unifiedEnabled: boolean;
  masterEnabled: boolean;
  featureEnabled: boolean;
  unifiedCanaryEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  pilotEnabled: boolean;
  suitePublicEnabled: boolean;
};

export function unifiedTemplateSubtitleCanaryEnabled(
  access: Pick<
    SubtitleTemplateAccess,
    | "masterEnabled"
    | "featureEnabled"
    | "unifiedCanaryEnabled"
    | "isAdmin"
    | "pilotEnabled"
  >,
) {
  return access.masterEnabled
    && access.featureEnabled
    && access.unifiedCanaryEnabled
    && access.isAdmin
    && access.pilotEnabled;
}

type UnifiedTemplateSubtitleLocalUploadEnvironment = {
  NODE_ENV?: string;
  UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED?: string;
  FILE_UPLOAD_RECEIVER_URL?: string;
};

function loopbackReceiver(value: URL) {
  const hostname = value.hostname.toLowerCase().replace(/\.$/, "");
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
}

export function unifiedTemplateSubtitleLocalUploadEnabled(input: {
  strictAccessEnabled: boolean;
  fileUploadAdminEnabled: boolean;
  receiverBaseUrl?: URL;
  environment?: UnifiedTemplateSubtitleLocalUploadEnvironment;
}) {
  const environment = input.environment ?? process.env;
  if (
    !input.strictAccessEnabled
    || !input.fileUploadAdminEnabled
    || environment.NODE_ENV === "production"
    || environment.UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED
      ?.trim()
      .toLowerCase() !== "true"
  ) {
    return false;
  }
  try {
    return loopbackReceiver(
      input.receiverBaseUrl
        ?? new URL(environment.FILE_UPLOAD_RECEIVER_URL || ""),
    );
  } catch {
    return false;
  }
}

function masterSwitchEnabled() {
  return process.env.SUBTITLE_TEMPLATES_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveSubtitleTemplateAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  unifiedCanaryEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  pilotEnabled?: boolean;
  suitePublicEnabled?: boolean;
}): SubtitleTemplateAccess {
  const pilotEnabled = input.pilotEnabled === true;
  const suitePublicEnabled = input.suitePublicEnabled === true;
  const access = {
    ...input,
    pilotEnabled,
    suitePublicEnabled,
  };
  return {
    ...access,
    // Preserve the already-public subtitle-template suite exactly as-is.
    enabled: input.masterEnabled
      && input.featureEnabled
      && (
        input.isAdmin
        || pilotEnabled
        || (input.publicEnabled && suitePublicEnabled)
      ),
    // The v5 unified template work is a separate, stricter admin canary.
    unifiedEnabled: unifiedTemplateSubtitleCanaryEnabled(access),
  };
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown; testerEnabled?: unknown }>,
  release: Awaited<ReturnType<typeof resolveEditorRelease>>,
) {
  const flags = new Map(
    flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]),
  );
  return resolveSubtitleTemplateAccess({
    masterEnabled: masterSwitchEnabled(),
    featureEnabled: flags.get(SUBTITLE_TEMPLATES_FLAG_KEY) === true,
    unifiedCanaryEnabled:
      flags.get(UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY) === true,
    publicEnabled: flags.get(SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY) === true,
    isAdmin: adminRows[0]?.isAdmin === true,
    pilotEnabled: adminRows[0]?.testerEnabled === true
      && release.channel === "canary"
      && subtitleEditingReleaseEnabled(release),
    suitePublicEnabled: release.channel === "stable"
      && subtitleEditingReleaseEnabled(release),
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
      unifiedCanaryEnabled: false,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: false,
      suitePublicEnabled: false,
    });
  }
  const flagRows = lock ? await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
    )
    for share
  ` : await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
    )
  `;
  const adminRows = !userId ? [] : lock ? await db`
    select app_user.is_admin,
      coalesce((
        select tester.enabled
        from shorts_mvp.editor_release_testers tester
        where tester.user_id=app_user.id
        limit 1
      ),false) as tester_enabled
    from shorts_mvp.app_users app_user
    where app_user.id=${userId} limit 1 for share
  ` : await db`
    select app_user.is_admin,
      coalesce((
        select tester.enabled
        from shorts_mvp.editor_release_testers tester
        where tester.user_id=app_user.id
        limit 1
      ),false) as tester_enabled
    from shorts_mvp.app_users app_user
    where app_user.id=${userId} limit 1
  `;
  const release = await resolveEditorRelease(db, userId);
  return accessFromRows(flagRows, adminRows, release);
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
