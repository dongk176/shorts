import { snsEditorRelease } from "./sns-editor-release";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { HttpError } from "./http";
import { CULTURE_COMMENT_PROFILE, type CommentProfile } from "./comment-profile";
import type { ProjectDispatchTarget } from "./job-dispatch";
import { resolveRequestedEditorRelease, type RequestedEditorRelease, type EditorReleaseAssignment } from "./editor-rendering-release";

export const LANGUAGE_TEST_UNAVAILABLE = "언어 기능을 잠시 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const targetSchema = z.object({
  releaseId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/),
  workerSourceGitSha: z.string().regex(/^[a-f0-9]{40}$/),
  imageUri: z.string().regex(/^181651591905\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com\/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$/),
  jobDefinitionArn: z.string().regex(/^arn:aws:batch:ap-northeast-2:181651591905:job-definition\/shorts-mvp-language-test-[a-z0-9-]+:[1-9][0-9]*$/),
  jobQueueArn: z.string().regex(/^arn:aws:batch:ap-northeast-2:181651591905:job-queue\/shorts-mvp-language-test-[a-z0-9-]+$/),
  renderSpecVersion: z.literal(4), captionRenderSpecVersion: z.literal(4),
  fontManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const lane = z.object({ current: targetSchema, previous: z.null(), schedulingMode: z.literal("fifo") }).strict();
export const languageTestRegistrySchema = z.object({
  version: z.literal(1), environment: z.literal("production"),
  lanes: z.object({ legacy_project: lane, source_range: lane, elevenlabs_transcription: lane, subtitle_templates: lane, unified_template_subtitles: lane }).strict(),
}).strict();

type Db = Sql | TransactionSql;
export function languageTestUnavailable() { return new HttpError(503, LANGUAGE_TEST_UNAVAILABLE, "LANGUAGE_TEST_UNAVAILABLE"); }

export async function languageTestStatus(db: Db) {
  const rows = await db`
    select s.enabled,s.public_rollout_percent,s.release_id,r.verified_at,r.registry::text as registry_json,
      e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.ui_version,e.document_version,e.staging_verified_at,e.render_spec_version,e.caption_render_spec_version
    from shorts_mvp.language_test_settings s
    left join shorts_mvp.language_test_releases r on r.id=s.release_id
    left join shorts_mvp.editor_releases e on e.id=r.id where s.singleton
  `;
  const row = rows[0];
  // postgres.camel also transforms JSON keys, including immutable lane names.
  let registry: unknown = null;
  try { registry = JSON.parse(row?.registryJson ?? "null"); } catch { /* Fail closed. */ }
  const parsed = languageTestRegistrySchema.safeParse(registry);
  const ready = Boolean(row?.verifiedAt && parsed.success
    && ["canary_ready", "canary_active", "approved"].includes(row.status)
    && row.uiVersion === 3 && row.documentVersion === 3 && row.stagingVerifiedAt
    && row.renderSpecVersion === 4 && row.captionRenderSpecVersion === 4
    && Object.values(parsed.data!.lanes).every(({ current: t }) => t.workerSourceGitSha === row.gitSha
      && t.imageUri.endsWith(`@${row.workerImageDigest}`) && t.fontManifestSha256 === row.fontManifestSha256));
  return { enabled: row?.enabled === true, publicEnabled: row?.publicRolloutPercent === 100, ready, releaseId: row?.releaseId as string | null, registry: ready && parsed.success ? parsed.data : null };
}

export function languageFeatureAllowed(
  state: { enabled: boolean; publicEnabled: boolean; ready: boolean },
  isAdmin: boolean,
) {
  return state.enabled && state.ready && (isAdmin || state.publicEnabled);
}

export async function lockLanguageTestAdmission(db: TransactionSql, userId: string | null) {
  const users = await db`select id,is_admin from shorts_mvp.app_users where id=${userId}`;
  if (!users[0]) throw new HttpError(401, "로그인 후 이용해 주세요.", "AUTH_REQUIRED");
  try {
    // Readers share the gate lock; only a settings change serializes admissions.
    // The jobs route retains the existing account lock, quota and request ID checks.
    await db`select pg_advisory_xact_lock_shared(hashtextextended('language_test_admission',0))`;
    await db`select singleton from shorts_mvp.language_test_settings where singleton for share`;
    const state = await languageTestStatus(db);
    if (!state.enabled || !state.ready || !state.registry || !state.releaseId) throw languageTestUnavailable();
    if (!languageFeatureAllowed(state, users[0].isAdmin === true)) {
      throw new HttpError(403, "언어 기능 공개가 중단되었습니다. 페이지를 새로고침해 주세요.", "LANGUAGE_PUBLIC_DISABLED");
    }
    return state as typeof state & { registry: NonNullable<typeof state.registry>; releaseId: string };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw languageTestUnavailable();
  }
}

export function languageTestTarget(state: { registry: z.infer<typeof languageTestRegistrySchema> }, key: ProjectDispatchTarget["targetKey"]): ProjectDispatchTarget {
  const t = state.registry.lanes[key].current;
  return { targetKey: key, releaseId: t.releaseId, workerSourceGitSha: t.workerSourceGitSha,
    workerImageDigest: digest.parse(t.imageUri.split("@")[1]), jobDefinitionArn: t.jobDefinitionArn, jobQueueArn: t.jobQueueArn,
    v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: t.fontManifestSha256 } };
}

/** Existing projects remain editable after admission is switched off. The caller
 * must supply an owned short ID; a requested release alone never grants access. */
export async function languageTestEditorRelease(db: Db, userId: string | null, shortId: string): Promise<EditorReleaseAssignment | null> {
  const marker = await db`select to_jsonb(j)->>'language_test_release_id' as language_test_release_id,
    s.template_snapshot->>'communityTemplateVersion' as community_template_version,
    s.template_snapshot->>'snsTemplateVersion' as sns_template_version
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=${shortId} and j.user_id=${userId} and s.user_id=${userId}`;
  if (marker[0]?.snsTemplateVersion) {
    return snsEditorRelease(db, userId, shortId, marker[0]?.communityTemplateVersion === "1");
  }
  if (!marker[0]?.languageTestReleaseId) return null;
  const rows = await db`select e.id,e.ui_version,e.document_version,e.font_manifest_sha256
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.language_test_releases r on r.id=j.language_test_release_id
    join shorts_mvp.editor_releases e on e.id=r.id
    where s.id=${shortId} and j.user_id=${userId} and s.user_id=${userId}
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
      and r.verified_at is not null and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
      and e.render_spec_version=4 and e.caption_render_spec_version=4`;
  const r = rows[0];
  if (!r) throw languageTestUnavailable();
  return { languageTest: true, channel: "canary", releaseId: r.id, uiVersion: r.uiVersion, documentVersion: r.documentVersion,
    subtitleEditingCapable: true, subtitleEditingPublicEnabled: true, renderSpecVersion: 4,
    captionRenderSpecVersion: 4, fontManifestSha256: r.fontManifestSha256, renderV4Authorized: true };
}

export async function resolveOwnedProjectEditorRelease(
  db: Db, userId: string | null, requested: RequestedEditorRelease, shortId: string,
): Promise<EditorReleaseAssignment> {
  const pinned = await languageTestEditorRelease(db, userId, shortId);
  if (!pinned) return resolveRequestedEditorRelease(db, userId, requested);
  if (pinned.releaseId !== requested.releaseId || pinned.channel !== requested.channel
    || pinned.uiVersion !== requested.uiVersion || pinned.documentVersion !== requested.documentVersion) {
    throw new HttpError(409, "이 프로젝트의 편집기를 다시 열어 주세요.", "EDITOR_RELEASE_CHANGED");
  }
  return pinned;
}

/** The release ID comes from an already-authorized owned project, never request input.
 * Admission OFF does not change the immutable profile of existing projects. */
export async function languageTestCommentProfile(
  db: Db, releaseId: string | null | undefined, outputLanguage: string,
): Promise<CommentProfile | undefined> {
  if (!releaseId || (outputLanguage !== "en" && outputLanguage !== "ja")) return undefined;
  try {
    const [row] = await db`select r.registry::text as registry_json
      from shorts_mvp.language_test_releases r join shorts_mvp.editor_releases e on e.id=r.id
      where r.id=${releaseId} and r.verified_at is not null and e.staging_verified_at is not null
        and e.status in ('canary_ready','canary_active','approved')`;
    const registry = languageTestRegistrySchema.parse(JSON.parse(row?.registryJson ?? "null"));
    // The existing immutable target release IDs encode the opt-in profile. This
    // keeps the submission registry shape and ordinary submitter unchanged.
    const targets = Object.entries(registry.lanes);
    const prefix = `language-${CULTURE_COMMENT_PROFILE}-`;
    if (!targets.some(([, lane]) => lane.current.releaseId.startsWith(prefix))) return undefined;
    if (!targets.every(([key, { current: t }]) => t.releaseId
      === `${prefix}${key.replaceAll("_", "-")}-${t.workerSourceGitSha.slice(0, 12)}`)) {
      throw languageTestUnavailable();
    }
    return CULTURE_COMMENT_PROFILE;
  } catch {
    throw languageTestUnavailable();
  }
}
