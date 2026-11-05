import "server-only";
import { uploadCandidateForUser } from "./file-upload-candidate";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";

type Evidence = {
  releaseId?: string; sourceGitSha?: string; workerImageDigest?: string; fontManifestSha256?: string;
  multilingualUpload?: { version?: number; phase?: string; sourceGitSha?: string; workerImageDigest?: string;
    cases?: { language?: string; generated?: boolean; silenceRemoved?: boolean; restored?: boolean; edited?: boolean; rendered?: boolean }[] };
};

/** Public language admission is pinned to the independently verified upload receiver. */
export function verifiedUploadLanguageEvidence(details: Evidence | null,
  env: Record<string, string | undefined> = process.env, releaseId?: string) {
  const proof = details?.multilingualUpload;
  if (!details?.releaseId || details.releaseId !== env.FILE_UPLOAD_MULTILINGUAL_VERIFIED_RELEASE_ID
    || (releaseId && releaseId !== details.releaseId)
    || !/^[a-f0-9]{40}$/.test(details.sourceGitSha ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(details.workerImageDigest ?? "")
    || !/^[a-f0-9]{64}$/.test(details.fontManifestSha256 ?? "")
    || details.sourceGitSha !== env.FILE_UPLOAD_WORKER_SOURCE_GIT_SHA
    || details.workerImageDigest !== env.FILE_UPLOAD_WORKER_IMAGE_DIGEST
    || details.fontManifestSha256 !== env.FILE_UPLOAD_WORKER_FONT_MANIFEST_SHA256
    || proof?.version !== 1 || proof.phase !== "verified"
    || proof.sourceGitSha !== details.sourceGitSha || proof.workerImageDigest !== details.workerImageDigest) return false;
  return ["ko", "en", "ja"].every(language => proof.cases?.some(c => c.language === language
    && c.generated === true && c.silenceRemoved === true && c.restored === true
    && c.edited === true && c.rendered === true));
}

export async function fileUploadLanguageEnabled(db: Sql | TransactionSql, releaseId?: string, userId?: string) {
  if (process.env.FILE_UPLOAD_CANDIDATE_RELEASE_ID) {
    const candidate = uploadCandidateForUser(userId ?? null);
    if (!candidate || (releaseId && releaseId !== candidate.releaseId)) return false;
    const [admin] = await db`select is_admin from shorts_mvp.app_users where id=${userId!} for share`;
    return admin?.isAdmin === true;
  }
  if (!process.env.FILE_UPLOAD_MULTILINGUAL_VERIFIED_RELEASE_ID) return false;
  const [row] = await db`select passed,details,successor from shorts_mvp.file_upload_release_checks
    where check_key='runtime_identity' for share`;
  return row?.passed === true && !row.successor
    && verifiedUploadLanguageEvidence(row.details, process.env, releaseId);
}

export async function requireFileUploadLanguage(db: Sql | TransactionSql, releaseId: string, userId?: string) {
  if (!await fileUploadLanguageEnabled(db, releaseId, userId)) {
    throw new HttpError(503, "파일 업로드 언어 처리를 준비 중입니다.", "FILE_UPLOAD_LANGUAGE_UNAVAILABLE");
  }
}
