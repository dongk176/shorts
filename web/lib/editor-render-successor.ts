import type { Sql, TransactionSql } from "postgres";
import type { EditorReleaseAssignment } from "./editor-rendering-release";

type Environment = {
  EDITOR_RENDER_SUCCESSOR_ENABLED?: string;
  EDITOR_RENDER_SUCCESSOR_SOURCE_SHA?: string;
};

/** Applies only to an owned editing page/request, never initial generation. */
export async function resolveOwnedEditorRenderSuccessor(
  db: Sql | TransactionSql,
  userId: string | null,
  shortId: string,
  base: EditorReleaseAssignment,
  environment: Environment = {
    EDITOR_RENDER_SUCCESSOR_ENABLED: process.env.EDITOR_RENDER_SUCCESSOR_ENABLED,
    EDITOR_RENDER_SUCCESSOR_SOURCE_SHA: process.env.EDITOR_RENDER_SUCCESSOR_SOURCE_SHA,
  },
): Promise<EditorReleaseAssignment> {
  const sourceSha = environment.EDITOR_RENDER_SUCCESSOR_SOURCE_SHA ?? "";
  if (environment.EDITOR_RENDER_SUCCESSOR_ENABLED !== "true"
    || !/^[0-9a-f]{40}$/.test(sourceSha)
    || !userId || base.channel !== "stable" || !base.releaseId
    || base.renderV4Authorized !== true || base.renderSpecVersion !== 4
    || base.captionRenderSpecVersion !== 4 || base.languageTest
    || base.silenceTest || base.silenceInline) return base;
  const rows = await db`
    select * from shorts_mvp.resolve_editor_render_successor(
      ${userId}::uuid,${shortId}::uuid,${base.releaseId}::uuid,
      ${sourceSha}::text
    )
  `;
  if (rows.length !== 1) return base;
  const row = rows[0];
  if (typeof row.releaseId !== "string" || row.releaseId === base.releaseId
    || !["stable", "canary"].includes(row.releaseChannel)
    || row.uiVersion !== base.uiVersion || row.documentVersion !== base.documentVersion
    || row.renderSpecVersion !== 4 || row.captionRenderSpecVersion !== 4
    || row.fontManifestSha256 !== base.fontManifestSha256) return base;
  return { ...base, releaseId: row.releaseId, channel: row.releaseChannel };
}
