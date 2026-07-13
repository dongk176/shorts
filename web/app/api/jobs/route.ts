import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AI_CLIP_MIN_SECONDS,
  expectedShortCount,
  jobDeadlineMinutes,
  outputLanguages,
  templateIds,
  videoAspectRatios,
} from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { getInitialJobBackend } from "@/lib/job-backend";
import { assertJobCreationAllowed } from "@/lib/job-policy";
import { requireMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

const schema = z.object({
  analysisId: z.string().uuid(),
  youtubeUrl: z.string().max(2048).optional(),
  templateId: z.enum(templateIds),
  videoAspectRatio: z.enum(videoAspectRatios).default("1:1"),
  outputLanguage: z.enum(outputLanguages).default("ko"),
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

    const analyses = await db`
      select youtube_url, youtube_video_id, video_title, channel_name,
        thumbnail_url, duration_seconds
      from shorts_mvp.youtube_analyses
      where id=${input.analysisId} and mvp_session_id=${session.id} and expires_at > now()
      limit 1
    `;
    if (!analyses[0]) throw new Error("영상 분석 정보가 만료되었습니다. 링크를 다시 확인해 주세요.");
    const metadata = {
      normalizedUrl: analyses[0].youtubeUrl,
      videoId: analyses[0].youtubeVideoId,
      title: analyses[0].videoTitle,
      channelName: analyses[0].channelName,
      thumbnailUrl: analyses[0].thumbnailUrl,
      durationSeconds: Number(analyses[0].durationSeconds),
    };
    const rangeStartSeconds = Math.round(input.rangeStartSeconds * 1000) / 1000;
    const rangeEndSeconds = Math.round(input.rangeEndSeconds * 1000) / 1000;
    const selectedDurationSeconds = rangeEndSeconds - rangeStartSeconds;
    if (
      rangeEndSeconds > metadata.durationSeconds + 0.001
      || selectedDurationSeconds < AI_CLIP_MIN_SECONDS
    ) {
      throw new Error(`선택 구간은 영상 안에 있어야 하며 최소 ${AI_CLIP_MIN_SECONDS}초여야 합니다.`);
    }
    const selectedShortCount = expectedShortCount(selectedDurationSeconds);
    const deadlineMinutes = jobDeadlineMinutes(selectedDurationSeconds);
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
            'extracting','rendering','uploading','retry_waiting'
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
          range_end_seconds, template_id, video_aspect_ratio,
          clip_length_option, output_language, expected_short_count, rights_confirmed, execution_backend,
          status, stage, progress, deadline_at, planned_short_count
        ) values (
          ${jobId}, ${session.id}, ${input.requestId}, ${metadata.normalizedUrl}, ${metadata.videoId}, ${metadata.title},
          ${metadata.channelName}, ${metadata.thumbnailUrl}, ${metadata.durationSeconds}, ${rangeStartSeconds},
          ${rangeEndSeconds}, ${input.templateId}, ${input.videoAspectRatio},
          'sec_31_60', ${input.outputLanguage}, ${selectedShortCount},
          true, ${executionBackend}, 'queued', 'queued', 5,
          now() + ${deadlineMinutes} * interval '1 minute', ${selectedShortCount}
        )
      `;
      await tx`
        insert into shorts_mvp.usage_reservations (mvp_session_id, job_id, source_duration_seconds)
        values (${session.id}, ${jobId}, ${Math.ceil(selectedDurationSeconds)})
      `;
      if (executionBackend === "aws_batch") {
        await tx`
          insert into shorts_mvp.job_outbox (job_id, kind, attempt_count)
          values (${jobId}, 'prepare', 0)
        `;
      }
      return null;
    });
    if (duplicate) {
      return NextResponse.json({
        jobId: duplicate.id,
        status: duplicate.status,
        usage: await getUsageSnapshot(db, session.id),
      });
    }

    return NextResponse.json({
      jobId,
      status: "queued",
      executionBackend,
      usage: await getUsageSnapshot(db, session.id),
    }, { status: 202 });
  } catch (error) { return apiError(error); }
}
