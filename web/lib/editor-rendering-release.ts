import type { Sql, TransactionSql } from "postgres";

export const EDITOR_RENDERING_V2_FLAG_KEY = "editor_rendering_v2";

export type EditorReleaseChannel = "legacy" | "stable" | "canary";

export type EditorReleaseAssignment = {
  channel: EditorReleaseChannel;
  releaseId: string | null;
  uiVersion: number | null;
  documentVersion: number | null;
};

export type RequestedEditorRelease = {
  releaseId: string;
  channel: Exclude<EditorReleaseChannel, "legacy">;
  uiVersion: number;
  documentVersion: number;
};

type EditorRenderingEnvironment = {
  NODE_ENV?: string;
  EDITOR_RENDERING_V2_ENABLED?: string;
  EDITOR_RENDERING_V2_GLOBAL_ENABLED?: string;
  EDITOR_RENDERING_V2_TEST_USER_IDS?: string;
};

export function editorRenderingV2MasterEnabled(
  environment: EditorRenderingEnvironment = process.env,
) {
  return environment.EDITOR_RENDERING_V2_ENABLED?.trim().toLowerCase() === "true";
}

export function editorRenderingV2TestUserIds(
  environment: EditorRenderingEnvironment = process.env,
) {
  return new Set(
    (environment.EDITOR_RENDERING_V2_TEST_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)),
  );
}

export function editorRenderingV2GlobalEnabled(
  environment: EditorRenderingEnvironment = process.env,
) {
  return environment.EDITOR_RENDERING_V2_GLOBAL_ENABLED
    ?.trim()
    .toLowerCase() === "true";
}

const legacyAssignment: EditorReleaseAssignment = {
  channel: "legacy",
  releaseId: null,
  uiVersion: null,
  documentVersion: null,
};

type EditorReleaseRow = {
  publicEnabled: boolean;
  canaryEnabled: boolean;
  runtimeEnabled: boolean;
  testerEnabled: boolean;
  userIsAdmin: boolean;
  stableReleaseId: string | null;
  stableUiVersion: number | null;
  stableDocumentVersion: number | null;
  stableStatus: string | null;
  candidateReleaseId: string | null;
  candidateUiVersion: number | null;
  candidateDocumentVersion: number | null;
  candidateStatus: string | null;
};

function releaseAssignment(
  channel: Exclude<EditorReleaseChannel, "legacy">,
  releaseId: string | null,
  uiVersion: number | null,
  documentVersion: number | null,
): EditorReleaseAssignment {
  if (!releaseId || !uiVersion || !documentVersion) return legacyAssignment;
  return { channel, releaseId, uiVersion, documentVersion };
}

export async function resolveEditorRelease(
  db: Sql | TransactionSql,
  userId: string | null,
  environment: EditorRenderingEnvironment = process.env,
): Promise<EditorReleaseAssignment> {
  if (!editorRenderingV2MasterEnabled(environment) || !userId) {
    return legacyAssignment;
  }
  const emergencyTestUser = editorRenderingV2TestUserIds(environment).has(userId);
  const rows = await db`
    select state.public_enabled,state.canary_enabled,
      coalesce(flag.enabled,false) as runtime_enabled,
      coalesce(tester.enabled,false) as tester_enabled,
      coalesce(release_user.is_admin,false) as user_is_admin,
      stable.id as stable_release_id,
      stable.ui_version as stable_ui_version,
      stable.document_version as stable_document_version,
      stable.status as stable_status,
      candidate.id as candidate_release_id,
      candidate.ui_version as candidate_ui_version,
      candidate.document_version as candidate_document_version,
      candidate.status as candidate_status
    from shorts_mvp.editor_release_state state
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    left join shorts_mvp.editor_release_testers tester
      on tester.user_id=${userId}
    left join shorts_mvp.app_users release_user
      on release_user.id=${userId}
    left join shorts_mvp.editor_releases stable
      on stable.id=state.stable_release_id
    left join shorts_mvp.editor_releases candidate
      on candidate.id=state.candidate_release_id
    where state.singleton=true
    limit 1
    for share of state
  `;
  const state = rows[0] as EditorReleaseRow | undefined;
  if (!state) return legacyAssignment;
  if (
    state.canaryEnabled
    && state.userIsAdmin
    && (state.testerEnabled || emergencyTestUser)
    && ["canary_ready", "canary_active", "approved"].includes(
      state.candidateStatus || "",
    )
  ) {
    return releaseAssignment(
      "canary",
      state.candidateReleaseId,
      Number(state.candidateUiVersion),
      Number(state.candidateDocumentVersion),
    );
  }
  if (
    editorRenderingV2GlobalEnabled(environment)
    && state.publicEnabled
    && state.runtimeEnabled
    && state.stableStatus === "stable"
  ) {
    return releaseAssignment(
      "stable",
      state.stableReleaseId,
      Number(state.stableUiVersion),
      Number(state.stableDocumentVersion),
    );
  }
  return legacyAssignment;
}

export async function resolveRequestedEditorRelease(
  db: Sql | TransactionSql,
  userId: string | null,
  requested: RequestedEditorRelease,
  environment: EditorRenderingEnvironment = process.env,
): Promise<EditorReleaseAssignment> {
  const current = await resolveEditorRelease(db, userId, environment);
  if (current.channel === "legacy") return legacyAssignment;
  if (
    current.releaseId === requested.releaseId
    && current.uiVersion === requested.uiVersion
    && current.documentVersion === requested.documentVersion
  ) {
    return current;
  }
  if (!editorRenderingV2GlobalEnabled(environment) || !userId) {
    return legacyAssignment;
  }
  const rows = await db`
    select release.id,release.ui_version,release.document_version,release.status,
      state.public_enabled,coalesce(flag.enabled,false) as runtime_enabled
    from shorts_mvp.editor_release_state state
    join shorts_mvp.editor_releases release on release.id in (
      state.stable_release_id,state.previous_stable_release_id
    )
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    where state.singleton=true and release.id=${requested.releaseId}
    limit 1
    for share of state
  `;
  const release = rows[0] as {
    id: string;
    uiVersion: number;
    documentVersion: number;
    status: string;
    publicEnabled: boolean;
    runtimeEnabled: boolean;
  } | undefined;
  if (
    !release
    || release.status !== "stable"
    || !release.publicEnabled
    || !release.runtimeEnabled
    || Number(release.uiVersion) !== requested.uiVersion
    || Number(release.documentVersion) !== requested.documentVersion
  ) {
    return legacyAssignment;
  }
  return releaseAssignment(
    "stable",
    release.id,
    Number(release.uiVersion),
    Number(release.documentVersion),
  );
}

export async function editorRenderingV2Enabled(
  db: Sql | TransactionSql,
  userId: string | null,
  environment: EditorRenderingEnvironment = process.env,
) {
  return (await resolveEditorRelease(db, userId, environment)).channel !== "legacy";
}
