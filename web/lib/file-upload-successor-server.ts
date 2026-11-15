import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { verifiedFileUploadSuccessorAdminReleaseId, type FileUploadWorkerIdentity } from "./file-upload-successor";

/** Reuse the DB's finalized, versioned additive-font proof; never infer compatibility. */
export async function verifiedUploadSuccessorForAdmin(
  db: Sql | TransactionSql,
  row: { passed?: unknown; details?: unknown; successor?: unknown },
  environment: FileUploadWorkerIdentity,
  adminEnabled: boolean,
) {
  const sameFont = verifiedFileUploadSuccessorAdminReleaseId(row, environment, adminEnabled);
  if (sameFont || !adminEnabled) return sameFont;
  const old = row.details as Record<string, unknown> | null;
  const next = (row.successor as { identity?: Record<string, unknown> } | null)?.identity;
  if (!next || !old || next.fontManifestSha256 === old.fontManifestSha256
    || typeof next.releaseId !== "string" || !/^[a-f0-9-]{36}$/.test(next.releaseId)
    || typeof old.fontManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(old.fontManifestSha256)) return null;
  const [proof] = await db`select shorts_mvp._verified_file_upload_successor_identity(
    ${next.releaseId}::uuid,${old.fontManifestSha256}) as identity`;
  return verifiedFileUploadSuccessorAdminReleaseId(row, environment, adminEnabled, Date.now(), proof?.identity);
}
