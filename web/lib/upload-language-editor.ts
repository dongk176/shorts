import type { Sql, TransactionSql } from "postgres";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import { HttpError } from "./http";

/** Read the owned project's immutable receiver release, never a global canary. */
export async function uploadLanguageEditorRelease(db: Sql | TransactionSql, userId: string | null,
  shortId: string): Promise<EditorReleaseAssignment> {
  const [row] = await db`select e.id,e.ui_version,e.document_version,e.font_manifest_sha256,
      (j.template_snapshot->>'shortsSilenceCandidateId'=e.id::text
        and exists(select 1 from shorts_mvp.upload_language_candidates c
          join shorts_mvp.app_users u on u.id=c.administrator_id and u.is_admin
          where c.release_id=e.id and c.administrator_id=j.user_id
            and j.created_at>=c.created_at and j.created_at<c.expires_at)) as silence_test,
      shorts_mvp.upload_language_project_release(j) as proof
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.editor_releases e on e.id=j.initial_editor_release_id
    where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
      and j.source_type='upload' and j.template_snapshot->'uploadLanguage' is not null
      and e.ui_version in (3,4) and e.document_version=3 for share of e`;
  if (!row || ![3,4].includes(Number(row.uiVersion)) || Number(row.documentVersion) !== 3
      || row.proof?.releaseId !== row.id || row.proof?.fontManifestSha256 !== row.fontManifestSha256) {
    throw new HttpError(409, "이 업로드 영상의 편집기 연결을 확인할 수 없습니다.", "UPLOAD_LANGUAGE_EDITOR_UNAVAILABLE");
  }
  return { silenceTest: row.silenceTest === true, languageTest: true, channel: "canary", releaseId: row.id, uiVersion: Number(row.uiVersion), documentVersion: 3,
    subtitleEditingCapable: true, subtitleEditingPublicEnabled: true, unifiedTemplateEditingCapable: true,
    renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: row.fontManifestSha256,
    renderV4Authorized: true };
}
