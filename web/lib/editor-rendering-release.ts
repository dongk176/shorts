import type { Sql, TransactionSql } from "postgres";

export const EDITOR_RENDERING_V2_FLAG_KEY = "editor_rendering_v2";
export const EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY =
  "editor_subtitle_editing_public";

export type EditorReleaseChannel = "legacy" | "stable" | "canary";

export type EditorReleaseAssignment = {
  channel: EditorReleaseChannel;
  releaseId: string | null;
  uiVersion: number | null;
  documentVersion: number | null;
  subtitleEditingCapable: boolean;
  subtitleEditingPublicEnabled: boolean;
  /** Immutable worker capability recorded on the assigned release. */
  renderSpecVersion?: number | null;
  /** Immutable caption capability paired with renderSpecVersion. */
  captionRenderSpecVersion?: number | null;
  /** Exact lowercase worker font-manifest digest recorded by the v4 probe. */
  fontManifestSha256?: string | null;
  /**
   * True only when the assigned release's immutable v4 capability also passed
   * the current kill-switch and internal/public rollout decision.
   */
  renderV4Authorized?: boolean;
};

export type RequestedEditorRelease = {
  releaseId: string;
  channel: Exclude<EditorReleaseChannel, "legacy">;
  uiVersion: number;
  documentVersion: number;
};

// Renderer capabilities belong to an immutable release, not to its current
// stable/canary channel. Add a release here only after its isolated render
// probe has accepted editor render spec v3. Unknown releases stay on v2 so a
// web rollout can never submit a document that makes an older worker exit.
const editorRenderSpecV3ReleaseIds = new Set([
  "775b464d-048e-4015-a721-5d48ea03f4b3",
  "28405fea-41bb-4151-b8c7-93e59a7b74b7",
]);

const editorRenderV4FontManifestSha256Pattern = /^[0-9a-f]{64}$/;
const editorRenderV4RolloutPercents = new Set([0, 5, 25, 100]);

export function editorReleaseSupportsRenderSpecV4(
  release: EditorReleaseAssignment,
) {
  return release.documentVersion === 3
    && release.releaseId !== null
    && release.renderSpecVersion === 4
    && release.captionRenderSpecVersion === 4
    && typeof release.fontManifestSha256 === "string"
    && editorRenderV4FontManifestSha256Pattern.test(
      release.fontManifestSha256,
    )
    && release.renderV4Authorized === true;
}

export function editorReleaseSupportsRenderSpecV3(
  release: EditorReleaseAssignment,
) {
  return release.documentVersion === 3
    && release.releaseId !== null
    && editorRenderSpecV3ReleaseIds.has(release.releaseId);
}

export function editorRenderSpecVersionForRelease(
  release: EditorReleaseAssignment,
): 2 | 3 | 4 {
  if (editorReleaseSupportsRenderSpecV4(release)) return 4;
  return editorReleaseSupportsRenderSpecV3(release) ? 3 : 2;
}

export function subtitleEditingReleaseEnabled(
  release: EditorReleaseAssignment,
) {
  if (!release.subtitleEditingCapable || release.documentVersion !== 3) {
    return false;
  }
  return release.channel === "canary"
    || (
      release.channel === "stable"
      && release.subtitleEditingPublicEnabled
    );
}

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
  subtitleEditingCapable: false,
  subtitleEditingPublicEnabled: false,
  renderSpecVersion: null,
  captionRenderSpecVersion: null,
  fontManifestSha256: null,
  renderV4Authorized: false,
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
  stableSubtitleEditingCapable: boolean;
  stableRenderSpecVersion: number | null;
  stableCaptionRenderSpecVersion: number | null;
  stableFontManifestSha256: string | null;
  candidateReleaseId: string | null;
  candidateUiVersion: number | null;
  candidateDocumentVersion: number | null;
  candidateStatus: string | null;
  candidateSubtitleEditingCapable: boolean;
  candidateRenderSpecVersion: number | null;
  candidateCaptionRenderSpecVersion: number | null;
  candidateFontManifestSha256: string | null;
  subtitleEditingPublicEnabled: boolean;
  renderV4InternalEnabled: boolean;
  renderV4RolloutPercent: number;
  renderV4KillSwitch: boolean;
  renderV4RolloutBucket: number;
  /** Administrator-only handoff attested by the durable successor controller. */
  successorAdminReleaseId?: string | null;
};

type EditorRenderV4ReleaseCapability = {
  renderSpecVersion: unknown;
  captionRenderSpecVersion: unknown;
  fontManifestSha256: unknown;
};

function integerOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function exactEditorRenderV4Capability(
  capability: EditorRenderV4ReleaseCapability,
) {
  return capability.renderSpecVersion === 4
    && capability.captionRenderSpecVersion === 4
    && typeof capability.fontManifestSha256 === "string"
    && editorRenderV4FontManifestSha256Pattern.test(
      capability.fontManifestSha256,
    );
}

function internalEditorRenderV4Authorized(
  state: Pick<
    EditorReleaseRow,
    | "testerEnabled"
    | "renderV4InternalEnabled"
    | "renderV4KillSwitch"
  >,
) {
  // The database v4 resolver admits persisted release testers only. The
  // emergency environment tester remains a v2/v3 recovery mechanism.
  return state.renderV4KillSwitch === false
    && state.renderV4InternalEnabled === true
    && state.testerEnabled === true;
}

function publicEditorRenderV4Authorized(
  state: Pick<
    EditorReleaseRow,
    | "renderV4RolloutPercent"
    | "renderV4KillSwitch"
    | "renderV4RolloutBucket"
  >,
) {
  const percent = state.renderV4RolloutPercent;
  const bucket = state.renderV4RolloutBucket;
  return state.renderV4KillSwitch === false
    && editorRenderV4RolloutPercents.has(percent)
    && Number.isInteger(bucket)
    && bucket >= 0
    && bucket < 100
    && percent > bucket;
}

function anonymousPublicEditorRenderV4Authorized(
  state: Pick<
    EditorReleaseRow,
    "renderV4RolloutPercent" | "renderV4KillSwitch"
  >,
) {
  // This resolver has no user identity and therefore no stable rollout
  // bucket. It may advertise v4 only after the public rollout reaches 100%.
  return state.renderV4KillSwitch === false
    && state.renderV4RolloutPercent === 100;
}

function releaseAssignment(
  channel: Exclude<EditorReleaseChannel, "legacy">,
  releaseId: string | null,
  uiVersion: number | null,
  documentVersion: number | null,
  subtitleEditingCapable: boolean,
  subtitleEditingPublicEnabled: boolean,
  v4Capability: EditorRenderV4ReleaseCapability,
  v4AuthorizedByRollout: boolean,
): EditorReleaseAssignment {
  if (!releaseId || !uiVersion || !documentVersion) return legacyAssignment;
  const renderSpecVersion = integerOrNull(v4Capability.renderSpecVersion);
  const captionRenderSpecVersion = integerOrNull(
    v4Capability.captionRenderSpecVersion,
  );
  const fontManifestSha256 = stringOrNull(
    v4Capability.fontManifestSha256,
  );
  return {
    channel,
    releaseId,
    uiVersion,
    documentVersion,
    subtitleEditingCapable,
    subtitleEditingPublicEnabled,
    renderSpecVersion,
    captionRenderSpecVersion,
    fontManifestSha256,
    renderV4Authorized: v4AuthorizedByRollout
      && exactEditorRenderV4Capability({
        renderSpecVersion,
        captionRenderSpecVersion,
        fontManifestSha256,
      }),
  };
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
      shorts_mvp.editor_target_successor_admin_release(${userId}::uuid)
        as successor_admin_release_id,
      coalesce(flag.enabled,false) as runtime_enabled,
      coalesce(tester.enabled,false) as tester_enabled,
      coalesce(release_user.is_admin,false) as user_is_admin,
      coalesce(state.render_v4_internal_enabled,false)
        as render_v4_internal_enabled,
      coalesce(state.render_v4_rollout_percent,0)
        as render_v4_rollout_percent,
      coalesce(state.render_v4_kill_switch,true)
        as render_v4_kill_switch,
      (
        ('x' || substr(md5(${userId}::text || ':editor-render-v4'),1,8))
          ::bit(32)::bigint % 100
      )::smallint as render_v4_rollout_bucket,
      stable.id as stable_release_id,
      stable.ui_version as stable_ui_version,
      stable.document_version as stable_document_version,
      stable.status as stable_status,
      coalesce(stable.subtitle_editing_capable,false)
        as stable_subtitle_editing_capable,
      stable.render_spec_version as stable_render_spec_version,
      stable.caption_render_spec_version
        as stable_caption_render_spec_version,
      stable.font_manifest_sha256 as stable_font_manifest_sha256,
      candidate.id as candidate_release_id,
      candidate.ui_version as candidate_ui_version,
      candidate.document_version as candidate_document_version,
      candidate.status as candidate_status,
      coalesce(candidate.subtitle_editing_capable,false)
        as candidate_subtitle_editing_capable,
      candidate.render_spec_version as candidate_render_spec_version,
      candidate.caption_render_spec_version
        as candidate_caption_render_spec_version,
      candidate.font_manifest_sha256 as candidate_font_manifest_sha256,
      coalesce(subtitle_public.enabled,false)
        as subtitle_editing_public_enabled
    from shorts_mvp.editor_release_state state
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    left join shorts_mvp.runtime_feature_flags subtitle_public
      on subtitle_public.flag_key=${EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY}
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
  // Public/internal flags are intentionally unchanged during a compatible
  // successor test. Only the DB-attested administrator and exact candidate may
  // use v4 in this narrow handoff; environment testers cannot grant this access.
  const successorAdminAllowed = state.userIsAdmin === true
    && state.runtimeEnabled === true
    && state.canaryEnabled === true
    && state.renderV4KillSwitch === false
    && typeof state.successorAdminReleaseId === "string"
    && state.successorAdminReleaseId === state.candidateReleaseId
    && ["canary_ready", "canary_active", "approved"].includes(state.candidateStatus || "")
    && state.candidateDocumentVersion === 3
    && state.candidateFontManifestSha256 === state.stableFontManifestSha256
    && exactEditorRenderV4Capability({
      renderSpecVersion: state.candidateRenderSpecVersion,
      captionRenderSpecVersion: state.candidateCaptionRenderSpecVersion,
      fontManifestSha256: state.candidateFontManifestSha256,
    });
  if (
    state.canaryEnabled
    && (
      successorAdminAllowed
      || (state.userIsAdmin && (state.testerEnabled || emergencyTestUser))
      || (state.testerEnabled && state.candidateSubtitleEditingCapable)
    )
    && ["canary_ready", "canary_active", "approved"].includes(
      state.candidateStatus || "",
    )
  ) {
    return releaseAssignment(
      "canary",
      state.candidateReleaseId,
      Number(state.candidateUiVersion),
      Number(state.candidateDocumentVersion),
      state.candidateSubtitleEditingCapable,
      state.subtitleEditingPublicEnabled,
      {
        renderSpecVersion: state.candidateRenderSpecVersion,
        captionRenderSpecVersion: state.candidateCaptionRenderSpecVersion,
        fontManifestSha256: state.candidateFontManifestSha256,
      },
      successorAdminAllowed || internalEditorRenderV4Authorized(state),
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
      state.stableSubtitleEditingCapable,
      state.subtitleEditingPublicEnabled,
      {
        renderSpecVersion: state.stableRenderSpecVersion,
        captionRenderSpecVersion: state.stableCaptionRenderSpecVersion,
        fontManifestSha256: state.stableFontManifestSha256,
      },
      publicEditorRenderV4Authorized(state),
    );
  }
  return legacyAssignment;
}

export async function resolvePublicEditorRelease(
  db: Sql | TransactionSql,
  environment: EditorRenderingEnvironment = process.env,
): Promise<EditorReleaseAssignment> {
  if (
    !editorRenderingV2MasterEnabled(environment)
    || !editorRenderingV2GlobalEnabled(environment)
  ) {
    return legacyAssignment;
  }
  const rows = await db`
    select state.public_enabled,
      coalesce(state.render_v4_rollout_percent,0)
        as render_v4_rollout_percent,
      coalesce(state.render_v4_kill_switch,true)
        as render_v4_kill_switch,
      coalesce(flag.enabled,false) as runtime_enabled,
      stable.id as stable_release_id,
      stable.ui_version as stable_ui_version,
      stable.document_version as stable_document_version,
      stable.status as stable_status,
      coalesce(stable.subtitle_editing_capable,false)
        as stable_subtitle_editing_capable,
      stable.render_spec_version as stable_render_spec_version,
      stable.caption_render_spec_version
        as stable_caption_render_spec_version,
      stable.font_manifest_sha256 as stable_font_manifest_sha256,
      coalesce(subtitle_public.enabled,false)
        as subtitle_editing_public_enabled
    from shorts_mvp.editor_release_state state
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    left join shorts_mvp.runtime_feature_flags subtitle_public
      on subtitle_public.flag_key=${EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY}
    left join shorts_mvp.editor_releases stable
      on stable.id=state.stable_release_id
    where state.singleton=true
    limit 1
    for share of state
  `;
  const state = rows[0] as Pick<
    EditorReleaseRow,
    | "publicEnabled"
    | "runtimeEnabled"
    | "stableReleaseId"
    | "stableUiVersion"
    | "stableDocumentVersion"
    | "stableStatus"
    | "stableSubtitleEditingCapable"
    | "subtitleEditingPublicEnabled"
    | "stableRenderSpecVersion"
    | "stableCaptionRenderSpecVersion"
    | "stableFontManifestSha256"
    | "renderV4RolloutPercent"
    | "renderV4KillSwitch"
  > | undefined;
  if (
    !state
    || !state.publicEnabled
    || !state.runtimeEnabled
    || state.stableStatus !== "stable"
  ) {
    return legacyAssignment;
  }
  return releaseAssignment(
    "stable",
    state.stableReleaseId,
    Number(state.stableUiVersion),
    Number(state.stableDocumentVersion),
    state.stableSubtitleEditingCapable,
    state.subtitleEditingPublicEnabled,
    {
      renderSpecVersion: state.stableRenderSpecVersion,
      captionRenderSpecVersion: state.stableCaptionRenderSpecVersion,
      fontManifestSha256: state.stableFontManifestSha256,
    },
    anonymousPublicEditorRenderV4Authorized(state),
  );
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
      release.subtitle_editing_capable,
      release.render_spec_version,release.caption_render_spec_version,
      release.font_manifest_sha256,
      state.public_enabled,coalesce(flag.enabled,false) as runtime_enabled,
      coalesce(state.render_v4_rollout_percent,0)
        as render_v4_rollout_percent,
      coalesce(state.render_v4_kill_switch,true)
        as render_v4_kill_switch,
      (
        ('x' || substr(md5(${userId}::text || ':editor-render-v4'),1,8))
          ::bit(32)::bigint % 100
      )::smallint as render_v4_rollout_bucket,
      coalesce(subtitle_public.enabled,false)
        as subtitle_editing_public_enabled
    from shorts_mvp.editor_release_state state
    join shorts_mvp.editor_releases release on release.id in (
      state.stable_release_id,state.previous_stable_release_id
    )
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    left join shorts_mvp.runtime_feature_flags subtitle_public
      on subtitle_public.flag_key=${EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY}
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
    subtitleEditingCapable: boolean;
    subtitleEditingPublicEnabled: boolean;
    renderSpecVersion: number | null;
    captionRenderSpecVersion: number | null;
    fontManifestSha256: string | null;
    renderV4RolloutPercent: number;
    renderV4KillSwitch: boolean;
    renderV4RolloutBucket: number;
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
    release.subtitleEditingCapable,
    release.subtitleEditingPublicEnabled,
    {
      renderSpecVersion: release.renderSpecVersion,
      captionRenderSpecVersion: release.captionRenderSpecVersion,
      fontManifestSha256: release.fontManifestSha256,
    },
    publicEditorRenderV4Authorized(release),
  );
}

export async function editorRenderingV2Enabled(
  db: Sql | TransactionSql,
  userId: string | null,
  environment: EditorRenderingEnvironment = process.env,
) {
  return (await resolveEditorRelease(db, userId, environment)).channel !== "legacy";
}
