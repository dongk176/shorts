import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { submitInitialJob } from "@/lib/aws";
import { clipLengthOptions, clipLengthRules, expectedShortCount, templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { getInitialJobBackend } from "@/lib/job-backend";
import { assertJobCreationAllowed } from "@/lib/job-policy";
import { requireMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({
  youtubeUrl: z.string().min(1).max(2048),
  templateId: z.enum(templateIds),
  clipLengthOption: z.enum(clipLengthOptions),
  rightsConfirmed: z.literal(true),
  requestId: z.string().uuid(),
  rangeStartSeconds: z.number().nonnegative(),
  rangeEndSeconds: z.number().positive(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const session = await requireMvpSession();
    const db = getDb();
    const executionBackend = getInitialJobBackend();
    const existing = await db`select id, status from shorts_mvp.video_jobs where mvp_session_id = ${session.id} and request_id = ${input.requestId}`;
    if (existing[0]) return NextResponse.json({ jobId: existing[0].id, status: existing[0].status, usage: await getUsageSnapshot(db, session.id) });
    // Circuit breaker logic removed to allow continuous testing with proxies.

    const metadata = await analyzeYoutubeUrl(input.youtubeUrl);
    const rangeStartSeconds = Math.round(input.rangeStartSeconds * 1000) / 1000;
    const rangeEndSeconds = Math.round(input.rangeEndSeconds * 1000) / 1000;
    const selectedDurationSeconds = rangeEndSeconds - rangeStartSeconds;
    const minimumClipSeconds = clipLengthRules[input.clipLengthOption].min;
    if (
      rangeEndSeconds > metadata.durationSeconds + 0.001
      || selectedDurationSeconds < minimumClipSeconds
    ) {
      throw new Error(`선택 구간은 영상 안에 있어야 하며 최소 ${minimumClipSeconds}초여야 합니다.`);
    }
    const selectedShortCount = expectedShortCount(selectedDurationSeconds);
    const maxActive = Number(process.env.MVP_MAX_ACTIVE_JOBS_PER_SESSION || 1);
    const jobId = randomUUID();
    const duplicate = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${session.id}, 0))`;
      const concurrentExisting = await tx`
        select id, status from shorts_mvp.video_jobs
        where mvp_session_id=${session.id} and request_id=${input.requestId}
      `;
      if (concurrentExisting[0]) {
        return {
          id: concurrentExisting[0].id,
          status: concurrentExisting[0].status,
        };
      }
      const limits = await tx`
        select count(*) filter (where status in (
            'validating','queued','starting','downloading','transcribing','selecting',
            'extracting','rendering','uploading'
          ))::int as active
        from shorts_mvp.video_jobs where mvp_session_id=${session.id}
      `;
      const beforeUsage = await getUsageSnapshot(tx, session.id);
      assertJobCreationAllowed({
        activeJobs: limits[0].active,
        maxActiveJobs: maxActive,
        sourceDurationSeconds: selectedDurationSeconds,
        usage: beforeUsage,
      });
      await tx`
        insert into shorts_mvp.video_jobs (
          id, mvp_session_id, request_id, youtube_url, youtube_video_id, video_title,
          channel_name, thumbnail_url, source_duration_seconds, range_start_seconds,
          range_end_seconds, template_id,
          clip_length_option, expected_short_count, rights_confirmed, execution_backend,
          status, stage, progress
        ) values (
          ${jobId}, ${session.id}, ${input.requestId}, ${metadata.normalizedUrl}, ${metadata.videoId}, ${metadata.title},
          ${metadata.channelName}, ${metadata.thumbnailUrl}, ${metadata.durationSeconds}, ${rangeStartSeconds},
          ${rangeEndSeconds}, ${input.templateId}, ${input.clipLengthOption}, ${selectedShortCount},
          true, ${executionBackend}, 'queued', 'queued', 5
        )
      `;
      await tx`
        insert into shorts_mvp.usage_reservations (mvp_session_id, job_id, source_duration_seconds)
        values (${session.id}, ${jobId}, ${Math.ceil(selectedDurationSeconds)})
      `;
      return null;
    });
    if (duplicate) {
      return NextResponse.json({
        jobId: duplicate.id,
        status: duplicate.status,
        usage: await getUsageSnapshot(db, session.id),
      });
    }

    if (executionBackend === "aws_batch") {
      try {
        const batchJobId = await submitInitialJob(jobId, selectedDurationSeconds);
        await db`update shorts_mvp.video_jobs set aws_batch_job_id = ${batchJobId} where id = ${jobId}`;
      } catch (error) {
        await db.begin(async (tx) => {
          await tx`update shorts_mvp.video_jobs set status='failed', stage='failed', progress=100, error_code='batch_submit_failed', error_message=${error instanceof Error ? error.message : "Batch 제출 실패"} where id=${jobId}`;
          await tx`update shorts_mvp.usage_reservations set status='released', released_at=now() where job_id=${jobId} and status='reserved'`;
        });
        throw error;
      }
    }
    return NextResponse.json({
      jobId,
      status: "queued",
      executionBackend,
      usage: await getUsageSnapshot(db, session.id),
    }, { status: 202 });
  } catch (error) { return apiError(error); }
}
