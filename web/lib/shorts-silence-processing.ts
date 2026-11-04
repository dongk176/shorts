import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { analyzeShortSilences } from "./shorts-silence-analysis";
import { silenceEditDocument, shortsSilenceEnabled, type SilenceEditableShort } from "./shorts-silence-contract";
import { parseInitialEditorRenderSpec } from "./editor-document-contract";
import { resolveEditorRelease, editorReleaseSupportsRenderSpecV4, subtitleEditingReleaseEnabled } from "./editor-rendering-release";
import { resolveOwnedProjectEditorRelease } from "./language-test";
import { HttpError } from "./http";
import { shortsSilenceRuntimeEnabled } from "./shorts-silence-access";

export async function processAdminShortSilence(db: Sql, shortId?: string, userId?: string) {
  if (!shortsSilenceEnabled()) return { status: "disabled" };
  if (!await shortsSilenceRuntimeEnabled(db)) return { status: "disabled" };
  await db`update shorts_mvp.admin_short_silence_tasks t set state='failed',
      error_code='SILENCE_LEASE_EXHAUSTED',updated_at=now()
    from shorts_mvp.app_users u where u.id=t.user_id and u.is_admin
      and t.state='processing' and t.lease_until<clock_timestamp() and t.attempts>=2`;
  // The renderer owns its normal lifecycle. Observe its result; never retry or
  // cancel an existing rendering request from this feature.
  await db`update shorts_mvp.admin_short_silence_tasks t
    set state=case when r.status='succeeded' then 'completed' else 'failed' end,
      error_code=case when r.status='succeeded' then null else 'SILENCE_RENDER_FAILED' end,updated_at=now()
    from shorts_mvp.editor_render_requests r,shorts_mvp.app_users u
    where t.request_id=r.id and u.id=t.user_id and u.is_admin and t.state='rendering'
      and r.status in ('succeeded','failed','superseded')`;
  const leaseId = randomUUID();
  const claimed = await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(715614824)`;
    const [active] = await tx`select count(*)::int as count from shorts_mvp.admin_short_silence_tasks
      where state='processing' and lease_until>clock_timestamp()`;
    if (active.count > 0) return null;
    const [source] = await tx`select s.*,j.channel_thumbnail_url,j.status as job_status,
        coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) as source_key,
        case when s.edit_timeline_s3_key is not null then s.edit_timeline_start_seconds else s.start_seconds end as timeline_start,
        case when s.edit_timeline_s3_key is not null then s.edit_timeline_end_seconds else s.end_seconds end as timeline_end,
        case when s.edit_timeline_s3_key is not null then s.edit_timeline_subtitle_segments else s.subtitle_segments end as source_subtitles
      from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id
      left join shorts_mvp.admin_short_silence_tasks t on t.short_id=s.id
      where u.is_admin and s.user_id=u.id and not j.is_example and j.midform_request is null
        and j.template_snapshot->'shortsSilenceRemoval'='{"version":1,"preset":"aggressive"}'::jsonb
        and j.status='completed' and j.user_deleted_at is null
        and s.status='ready' and s.render_version=1 and s.editor_document is null
        and s.pending_edit_request_id is null and s.deleted_at is null and s.expires_at>clock_timestamp()
        and s.output_s3_key is not null and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
        and (${shortId ?? null}::uuid is null or s.id=${shortId ?? null})
        and (${userId ?? null}::uuid is null or u.id=${userId ?? null})
        and (t.short_id is null or (t.state='processing' and t.lease_until<clock_timestamp() and t.attempts<2))
      order by s.created_at,s.clip_index limit 1 for update of s skip locked`;
    if (!source) return null;
    const [task] = await tx`insert into shorts_mvp.admin_short_silence_tasks
      (short_id,job_id,user_id,request_id,lease_id,lease_until,state)
      values (${source.id},${source.jobId},${source.userId},${randomUUID()},${leaseId},now()+interval '3 minutes','processing')
      on conflict (short_id) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until,
        state='processing',attempts=admin_short_silence_tasks.attempts+1,error_code=null,updated_at=now()
      where admin_short_silence_tasks.state='processing'
        and admin_short_silence_tasks.lease_until<clock_timestamp() and admin_short_silence_tasks.attempts<2
      returning request_id`;
    return task ? { source, requestId: String(task.requestId) } : null;
  });
  if (!claimed) return { status: "idle" };
  const { source, requestId } = claimed;
  try {
    const initialSpec = parseInitialEditorRenderSpec(source.initialRenderSpec);
    const release = await resolveEditorRelease(db, source.userId);
    if (!editorReleaseSupportsRenderSpecV4(release) || release.channel === "legacy" || !release.releaseId
      || source.subtitleTemplateId && !subtitleEditingReleaseEnabled(release)) throw new Error("SILENCE_EDITOR_UNAVAILABLE");
    const silences = await analyzeShortSilences(String(source.sourceKey), Number(source.startSeconds) - Number(source.timelineStart), Number(source.endSeconds) - Number(source.timelineStart));
    const input: SilenceEditableShort = {
      id: source.id, renderVersion: Number(source.renderVersion), templateId: source.templateId,
      customTemplateId: source.customTemplateId, templateSnapshot: source.templateSnapshot,
      videoAspectRatio: source.videoAspectRatio, hookTitle: source.hookTitle, channelDisplayName: source.channelDisplayName,
      titleTextStyles: source.titleTextStyles || [], initialRenderSpec: initialSpec,
      subtitlesEnabled: source.subtitlesEnabled, commentOverlays: source.commentOverlays || [],
      startSeconds: Number(source.startSeconds), endSeconds: Number(source.endSeconds),
    };
    const plan = silenceEditDocument(input, { start: Number(source.timelineStart), end: Number(source.timelineEnd), subtitles: source.sourceSubtitles || [] }, silences);
    plan.document.channel.thumbnailUrl = source.channelThumbnailUrl || null;
    if (!plan.cutCount) {
      await db`update shorts_mvp.admin_short_silence_tasks set state='completed',updated_at=now()
        where short_id=${source.id} and lease_id=${leaseId} and state='processing'`;
      return { status: "completed", shortId: source.id, cutCount: 0, removedSeconds: 0 };
    }
    const requested = { releaseId: release.releaseId, channel: release.channel,
      uiVersion: release.uiVersion!, documentVersion: release.documentVersion! };
    await db.begin(async tx => {
      const [gate] = await tx`select enabled from shorts_mvp.runtime_feature_flags where flag_key='admin_shorts_silence' for share`;
      if (gate?.enabled !== true) throw new Error("SILENCE_STOPPED");
      const locked = await resolveOwnedProjectEditorRelease(tx, source.userId, requested, source.id);
      if (!editorReleaseSupportsRenderSpecV4(locked) || source.subtitleTemplateId && !subtitleEditingReleaseEnabled(locked)) throw new Error("SILENCE_EDITOR_CHANGED");
      const [task] = await tx`select short_id from shorts_mvp.admin_short_silence_tasks
        where short_id=${source.id} and lease_id=${leaseId} and state='processing' and lease_until>clock_timestamp() for update`;
      if (!task) throw new Error("SILENCE_LEASE_EXPIRED");
      const [current] = await tx`select s.id from shorts_mvp.generated_shorts s
        join shorts_mvp.video_jobs j on j.id=s.job_id join shorts_mvp.app_users u on u.id=j.user_id
        where s.id=${source.id} and s.user_id=${source.userId} and u.id=s.user_id and u.is_admin
          and j.template_snapshot->'shortsSilenceRemoval'='{"version":1,"preset":"aggressive"}'::jsonb
          and not j.is_example and j.midform_request is null and j.user_deleted_at is null
          and s.status='ready' and s.render_version=1 and s.editor_document is null
          and s.pending_edit_request_id is null and s.deleted_at is null and s.expires_at>clock_timestamp()
          and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key)=${source.sourceKey}
          and coalesce(s.edit_timeline_version,0)=${Number(source.editTimelineVersion || 0)}
          and s.initial_render_spec=${tx.json(source.initialRenderSpec)}::jsonb
          and s.caption_render_spec is not distinct from ${source.captionRenderSpec ? tx.json(source.captionRenderSpec) : null}::jsonb
        for update of s for share of j,u`;
      if (!current) throw new Error("SILENCE_SOURCE_CHANGED");
      const hash = createHash("md5").update(JSON.stringify(plan.document)).digest("hex");
      await tx`insert into shorts_mvp.editor_render_requests
        (id,short_id,user_id,base_render_version,snapshot_hash,status,release_id,release_channel)
        values (${requestId},${source.id},${source.userId},1,${hash},'queued',${locked.releaseId},${locked.channel})`;
      await tx`update shorts_mvp.generated_shorts set status='rerendering',rerender_progress=5,
        pending_edit_snapshot=${tx.json(plan.document)},pending_render_hash=${hash},pending_edit_request_id=${requestId},
        rerender_batch_job_id=null,render_error_code=null,render_error_message=null where id=${source.id}`;
      await tx`insert into shorts_mvp.editor_render_outbox(request_id,short_id) values (${requestId},${source.id})`;
      await tx`update shorts_mvp.admin_short_silence_tasks set state='rendering',cut_count=${plan.cutCount},
        removed_seconds=${plan.removedSeconds},updated_at=now() where short_id=${source.id} and lease_id=${leaseId}`;
    });
    return { status: "rendering", shortId: source.id, requestId, cutCount: plan.cutCount, removedSeconds: plan.removedSeconds };
  } catch (error) {
    const code = error instanceof Error && /^SILENCE_[A-Z_]+$/.test(error.message) ? error.message : "SILENCE_PROCESSING_FAILED";
    await db`update shorts_mvp.admin_short_silence_tasks set state='failed',error_code=${code},updated_at=now()
      where short_id=${source.id} and lease_id=${leaseId} and state='processing'`;
    console.warn("admin_short_silence_failed", { shortId: source.id, code });
    throw new HttpError(503, "무음 정리를 완료하지 못했어요. 원본 결과는 그대로 보관돼 있어요.", code);
  }
}
