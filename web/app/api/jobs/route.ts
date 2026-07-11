import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { submitInitialJob } from "@/lib/aws";
import { clipLengthOptions, templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({
  youtubeUrl: z.string().min(1).max(2048),
  templateId: z.enum(templateIds),
  clipLengthOption: z.enum(clipLengthOptions),
  rightsConfirmed: z.literal(true),
  requestId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const session = await requireMvpSession();
    const db = getDb();
    const existing = await db`select id, status from shorts_mvp.video_jobs where mvp_session_id = ${session.id} and request_id = ${input.requestId}`;
    if (existing[0]) return NextResponse.json({ jobId: existing[0].id, status: existing[0].status, usage: await getUsageSnapshot(db, session.id) });

    const metadata = await analyzeYoutubeUrl(input.youtubeUrl);
    const maxActive = Number(process.env.MVP_MAX_ACTIVE_JOBS_PER_SESSION || 1);
    const dailyLimit = Number(process.env.MVP_DAILY_JOB_LIMIT || 3);
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600_000);
    const dayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
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
        select
          count(*) filter (where status in (
            'validating','queued','starting','downloading','transcribing','selecting',
            'extracting','rendering','uploading'
          ))::int as active,
          count(*) filter (where created_at >= ${dayStart})::int as daily
        from shorts_mvp.video_jobs where mvp_session_id=${session.id}
      `;
      if (limits[0].active >= maxActive) {
        throw new Error("현재 처리 중인 작업이 있습니다. 완료 후 다시 시도해 주세요.");
      }
      if (limits[0].daily >= dailyLimit) {
        throw new Error("오늘 생성할 수 있는 작업 수를 모두 사용했습니다.");
      }
      const beforeUsage = await getUsageSnapshot(tx, session.id);
      if (
        beforeUsage.enforcementEnabled
        && beforeUsage.usedSeconds + beforeUsage.reservedSeconds + metadata.durationSeconds
          > beforeUsage.limitSeconds
      ) {
        throw new Error("선택한 플랜의 이번 달 원본 영상 처리 시간을 초과합니다.");
      }
      await tx`
        insert into shorts_mvp.video_jobs (
          id, mvp_session_id, request_id, youtube_url, youtube_video_id, video_title,
          channel_name, thumbnail_url, source_duration_seconds, template_id,
          clip_length_option, expected_short_count, rights_confirmed, status, stage, progress
        ) values (
          ${jobId}, ${session.id}, ${input.requestId}, ${metadata.normalizedUrl}, ${metadata.videoId}, ${metadata.title},
          ${metadata.channelName}, ${metadata.thumbnailUrl}, ${metadata.durationSeconds}, ${input.templateId},
          ${input.clipLengthOption}, ${metadata.expectedShortCount}, true, 'queued', 'queued', 5
        )
      `;
      await tx`
        insert into shorts_mvp.usage_reservations (mvp_session_id, job_id, source_duration_seconds)
        values (${session.id}, ${jobId}, ${metadata.durationSeconds})
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

    try {
      const batchJobId = await submitInitialJob(jobId, metadata.durationSeconds);
      await db`update shorts_mvp.video_jobs set aws_batch_job_id = ${batchJobId} where id = ${jobId}`;
    } catch (error) {
      await db.begin(async (tx) => {
        await tx`update shorts_mvp.video_jobs set status='failed', stage='failed', progress=100, error_code='batch_submit_failed', error_message=${error instanceof Error ? error.message : "Batch 제출 실패"} where id=${jobId}`;
        await tx`update shorts_mvp.usage_reservations set status='released', released_at=now() where job_id=${jobId} and status='reserved'`;
      });
      throw error;
    }
    return NextResponse.json({ jobId, status: "queued", usage: await getUsageSnapshot(db, session.id) }, { status: 202 });
  } catch (error) { return apiError(error); }
}
