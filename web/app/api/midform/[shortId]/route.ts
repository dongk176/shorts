import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getMidformEditSourceUrl, getShortPlaybackAccess } from "@/lib/aws";
import { midformRelease } from "@/lib/midform-release";
import { readLimitedJsonBody } from "@/lib/file-upload-control";
import { apiError, HttpError } from "@/lib/http";
import { midformAccess } from "@/lib/midform-access";
import { midformDraftSchema, validateMidformDraft } from "@/lib/midform-cloud";
import type { MidformDraft, MidformRow } from "@/lib/midform-local";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ shortId: string }> };
type Document = MidformDraft & {
  duration: number; sourceDuration: number; revision: number; draft?: MidformDraft;
  target: number; selectionMode: string; silences: number[][]; renderedDraft: MidformDraft;
  outputSrt?: string;
};
const inputSchema = z.object({
  draft: midformDraftSchema, revision: z.number().int().nonnegative(),
  renderVersion: z.number().int().nonnegative(), requestId: z.string().uuid().optional(),
  generateCaptions: z.boolean().optional(),
}).strict();

async function owned(request: Request, context: Context) {
  const { db, session } = await midformAccess(request);
  const shortId = z.string().uuid().parse((await context.params).shortId);
  return { db, session, shortId };
}

export async function GET(request: Request, context: Context) {
  try {
    const { db, session, shortId } = await owned(request, context);
    const rows = await db`
      select s.midform_document::text as midform_document_json,s.status,s.render_version,s.output_s3_key,s.clean_clip_s3_key,
        s.expires_at,s.render_error_message,j.video_title
      from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and s.user_id=${session.userId} and j.user_deleted_at is null
        and s.midform_document is not null and s.deleted_at is null and s.expires_at > now()
        and s.status in ('ready','rerendering')
    `;
    const row = rows[0];
    if (!row) throw new HttpError(404, "편집 영상을 찾을 수 없습니다.");
    // Preserve dynamic speaker keys; the DB client camel-cases keys inside JSONB.
    const doc = JSON.parse(String(row.midformDocumentJson)) as Document;
    if (new URL(request.url).searchParams.get("format") === "srt") {
      return new Response(doc.outputSrt || "", { headers: { "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Disposition": 'attachment; filename="easycut.srt"', "Cache-Control": "private, no-store" } });
    }
    const draft = doc.draft || doc;
    const [sourceUrl, output] = await Promise.all([
      getMidformEditSourceUrl(String(row.cleanClipS3Key), row.expiresAt as Date),
      getShortPlaybackAccess({ outputKey: String(row.outputS3Key), thumbnailKey: null, expiresAt: row.expiresAt as Date }),
    ]);
    return NextResponse.json({
      token: "session", projectId: shortId, generation: Number(row.renderVersion), revision: doc.revision,
      renderVersion: Number(row.renderVersion), title: row.videoTitle, duration: doc.duration,
      sourceDuration: doc.sourceDuration, rows: draft.rows, framing: draft.framing, names: draft.names,
      removeSilence: true, silencePreset: "aggressive", entertainment: draft.entertainment,
      silences: doc.silences, silenceProfiles: { aggressive: doc.silences }, target: doc.target,
      selectionMode: doc.selectionMode, busy: row.status === "rerendering",
      status: row.status === "rerendering" ? "rendering" : "ready", error: row.renderErrorMessage,
      exportReady: row.status === "ready", exportDraft: doc.renderedDraft,
      sourceUrl, outputUrl: output.url, subtitleUrl: `/api/midform/${shortId}?format=srt`,
      note: "선택된 이야기의 편집본입니다. 전체 원본은 처리 후 삭제됩니다.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

async function mutate(request: Request, context: Context, render: boolean) {
  const { db, session, shortId } = await owned(request, context);
  const input = inputSchema.parse(await readLimitedJsonBody(request, 4 * 1024 * 1024));
  if (render && !input.requestId) throw new HttpError(400, "저장 요청을 다시 시도해 주세요.");
  if (!render && input.generateCaptions) throw new HttpError(400, "자막 생성은 내보내기 요청으로 진행해 주세요.");
  return db.begin(async tx => {
    const rows = await tx`
      select s.midform_document::text as midform_document_json,s.status,s.render_version,j.midform_release_id
      from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and s.user_id=${session.userId} and j.user_deleted_at is null
        and s.midform_document is not null and s.deleted_at is null and s.expires_at > now()
      for update of s
    `;
    const row = rows[0];
    if (!row) throw new HttpError(404, "편집 영상을 찾을 수 없습니다.");
    // Preserve dynamic speaker keys; the DB client camel-cases keys inside JSONB.
    const doc = JSON.parse(String(row.midformDocumentJson)) as Document;
    const draft = validateMidformDraft(input.draft, doc.rows as MidformRow[]);
    const hash = createHash("md5").update(JSON.stringify({ shortId, ...input })).digest("hex");
    if (render) {
      const previous = await tx`select snapshot_hash from shorts_mvp.editor_render_requests
        where id=${input.requestId!} and short_id=${shortId} and user_id=${session.userId}`;
      if (previous[0]) {
        if (previous[0].snapshotHash !== hash) throw new HttpError(409, "저장 요청이 변경되었습니다.");
        return { status: row.status, revision: doc.revision };
      }
    }
    if (row.status !== "ready" || Number(row.renderVersion) !== input.renderVersion || doc.revision !== input.revision) {
      throw new HttpError(409, "다른 화면에서 편집이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    const revision = doc.revision + 1;
    await tx`update shorts_mvp.generated_shorts set midform_document=jsonb_set(
      jsonb_set(midform_document,'{draft}',${tx.json(draft)}),'{revision}',${tx.json(revision)}) where id=${shortId}`;
    if (!render) return { status: "saved", revision };
    if (!row.midformReleaseId) {
      throw new HttpError(503, "긴 영상 편집 서버를 준비하고 있습니다.");
    }
    const release = await midformRelease(tx, session.userId, String(row.midformReleaseId));
    const snapshot = { version: 4, kind: "midform", sourceShortId: shortId,
      baseRenderVersion: input.renderVersion, draft, requestId: input.requestId,
      ...(input.generateCaptions ? { generateCaptions: true } : {}) };
    await tx`insert into shorts_mvp.editor_render_requests
      (id,short_id,user_id,base_render_version,snapshot_hash,status,release_id,release_channel)
      values (${input.requestId!},${shortId},${session.userId},${input.renderVersion},${hash},'queued',
        ${release.releaseId!},${"canary"})`;
    await tx`update shorts_mvp.generated_shorts set status='rerendering',rerender_progress=5,
      pending_edit_snapshot=${tx.json(snapshot)},pending_edit_request_id=${input.requestId!},
      pending_render_hash=${hash},rerender_batch_job_id=null,render_error_code=null,render_error_message=null
      where id=${shortId}`;
    await tx`insert into shorts_mvp.editor_render_outbox (request_id,short_id) values (${input.requestId!},${shortId})`;
    return { status: "rendering", revision };
  });
}
export async function PATCH(request: Request, context: Context) {
  try { return NextResponse.json(await mutate(request, context, false)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try { return NextResponse.json(await mutate(request, context, true), { status: 202 }); }
  catch (error) { return apiError(error); }
}
