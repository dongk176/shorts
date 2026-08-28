import type { Sql, TransactionSql } from "postgres";
import {
  editorRenderingV2GlobalEnabled,
  editorRenderingV2MasterEnabled,
  resolvePublicEditorRelease,
  resolveEditorRelease,
  subtitleEditingReleaseEnabled,
} from "@/lib/editor-rendering-release";

export const SUBTITLE_TEMPLATES_FLAG_KEY = "subtitle_templates";
export const SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY = "subtitle_templates_public";
export const UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY =
  "unified_template_subtitles_canary";
export const UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY =
  "unified_template_subtitles_public";

export type SubtitleTemplateAccess = {
  enabled: boolean;
  unifiedEnabled: boolean;
  masterEnabled: boolean;
  featureEnabled: boolean;
  unifiedCanaryEnabled: boolean;
  unifiedPublicEnabled: boolean;
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

export function unifiedTemplateSubtitlePublicEnabled(
  access: Pick<
    SubtitleTemplateAccess,
    | "masterEnabled"
    | "featureEnabled"
    | "publicEnabled"
    | "unifiedPublicEnabled"
    | "suitePublicEnabled"
  >,
) {
  return access.masterEnabled
    && access.featureEnabled
    && access.publicEnabled
    && access.unifiedPublicEnabled
    && access.suitePublicEnabled;
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

function disabledAccess() {
  return resolveSubtitleTemplateAccess({
    masterEnabled: false,
    featureEnabled: false,
    unifiedCanaryEnabled: false,
    unifiedPublicEnabled: false,
    publicEnabled: false,
    isAdmin: false,
    pilotEnabled: false,
    suitePublicEnabled: false,
  });
}

export function resolveSubtitleTemplateAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  unifiedCanaryEnabled: boolean;
  unifiedPublicEnabled?: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  pilotEnabled?: boolean;
  suitePublicEnabled?: boolean;
}): SubtitleTemplateAccess {
  const pilotEnabled = input.pilotEnabled === true;
  const suitePublicEnabled = input.suitePublicEnabled === true;
  const unifiedPublicEnabled = input.unifiedPublicEnabled === true;
  const access = {
    ...input,
    pilotEnabled,
    suitePublicEnabled,
    unifiedPublicEnabled,
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
    // Keep the administrator canary and the public stable admission switches
    // independent so either path can be stopped without changing the other.
    unifiedEnabled: unifiedTemplateSubtitleCanaryEnabled(access)
      || unifiedTemplateSubtitlePublicEnabled(access),
  };
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown; testerEnabled?: unknown }>,
  release: Awaited<ReturnType<typeof resolveEditorRelease>>,
  allowAdministratorCanary: boolean,
) {
  const flags = new Map(
    flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]),
  );
  return resolveSubtitleTemplateAccess({
    masterEnabled: masterSwitchEnabled(),
    featureEnabled: flags.get(SUBTITLE_TEMPLATES_FLAG_KEY) === true,
    unifiedCanaryEnabled:
      allowAdministratorCanary
      && flags.get(UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY) === true,
    unifiedPublicEnabled:
      flags.get(UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY) === true,
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
  resolvedRelease?: Awaited<ReturnType<typeof resolveEditorRelease>>,
  allowAdministratorCanary: boolean = true,
) {
  if (!masterSwitchEnabled()) {
    return disabledAccess();
  }
  return (await readAccessContext(
    db,
    userId,
    lock,
    resolvedRelease,
    allowAdministratorCanary,
  )).subtitleAccess;
}

async function readAccessContext(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
  resolvedRelease?: Awaited<ReturnType<typeof resolveEditorRelease>>,
  allowAdministratorCanary: boolean = true,
) {
  const flagRows = lock ? await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY}
    )
    for share
  ` : await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${SUBTITLE_TEMPLATES_FLAG_KEY},
      ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY},
      ${UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY}
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
  const release = resolvedRelease ?? await resolveEditorRelease(db, userId);
  return {
    editorRelease: release,
    subtitleAccess: accessFromRows(
      flagRows,
      adminRows,
      release,
      allowAdministratorCanary,
    ),
  };
}

async function resolveEffectiveSubtitleTemplateContext(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
) {
  if (!masterSwitchEnabled()) {
    return {
      editorRelease: await resolveEditorRelease(db, userId),
      subtitleAccess: disabledAccess(),
    };
  }
  const currentContext = await readAccessContext(
    db,
    userId,
    lock,
  );
  const { editorRelease } = currentContext;
  const subtitleAccess = subtitleEditingReleaseEnabled(editorRelease)
    ? currentContext.subtitleAccess
    : disabledAccess();
  if (subtitleAccess.unifiedEnabled || editorRelease.channel !== "canary") {
    return { editorRelease, subtitleAccess };
  }

  // A non-administrator can be enrolled in an unrelated editor canary. That
  // assignment must not hide the stable public subtitle release from them.
  // The same fallback also applies to administrators so the editor page and
  // every mutation API authorize the same saved template.
  const publicEditorRelease = await resolvePublicEditorRelease(db);
  const publicSubtitleAccess = subtitleEditingReleaseEnabled(publicEditorRelease)
    ? await readAccess(db, userId, lock, publicEditorRelease, false)
    : disabledAccess();
  if (publicSubtitleAccess.unifiedEnabled) {
    return {
      editorRelease: publicEditorRelease,
      subtitleAccess: publicSubtitleAccess,
    };
  }
  return { editorRelease, subtitleAccess };
}

export function resolveUnifiedTemplateSubtitleEditorContext(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return resolveEffectiveSubtitleTemplateContext(db, userId, false);
}

export async function getEffectiveSubtitleTemplateAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return (await resolveEffectiveSubtitleTemplateContext(db, userId, false))
    .subtitleAccess;
}

export async function lockEffectiveSubtitleTemplateAccess(
  db: TransactionSql,
  userId: string | null,
) {
  return (await resolveEffectiveSubtitleTemplateContext(db, userId, true))
    .subtitleAccess;
}

export async function getUnifiedTemplateSubtitlePublicPreviewAccess(
  db: Sql | TransactionSql,
) {
  if (
    !masterSwitchEnabled()
    || !editorRenderingV2MasterEnabled()
    || !editorRenderingV2GlobalEnabled()
  ) {
    return false;
  }
  const rows = await db`
    select state.public_enabled
      and release.status='stable'
      and release.subtitle_editing_capable=true
      and release.document_version=3
      and coalesce((
        select count(*)=5
        from shorts_mvp.runtime_feature_flags flag
        where flag.enabled=true and flag.flag_key in (
          ${SUBTITLE_TEMPLATES_FLAG_KEY},
          ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
          ${UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY},
          'editor_rendering_v2',
          'editor_subtitle_editing_public'
        )
      ),false) as enabled
    from shorts_mvp.editor_release_state state
    join shorts_mvp.editor_releases release
      on release.id=state.stable_release_id
    where state.singleton=true
    limit 1
  `;
  return rows[0]?.enabled === true;
}

export function getSubtitleTemplateAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, false);
}

export async function getPublicSubtitleTemplateAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  const publicEditorRelease = await resolvePublicEditorRelease(db);
  return readAccess(db, userId, false, publicEditorRelease, false);
}

export function lockSubtitleTemplateAccess(
  db: TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, true);
}
