import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const jobIdSchema = z.string().uuid();
const unavailableStatuses = new Set(["failed", "expired", "deleted"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    assertSameOriginJsonRequest(request);
    const jobId = jobIdSchema.parse((await context.params).jobId);
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();

    const notification = await db.begin(async (tx) => {
      const rows = await tx`
        select j.id,j.status,u.email
        from shorts_mvp.video_jobs j
        join shorts_mvp.app_users u on u.id=j.user_id
        where j.id=${jobId} and j.user_id=${session.userId}
          and not j.is_example
        limit 1
        for update of j
      `;
      const job = rows[0];
      if (!job) {
        throw new HttpError(404, "알림을 신청할 작업을 찾을 수 없습니다.");
      }
      if (unavailableStatuses.has(String(job.status))) {
        throw new HttpError(409, "완료되지 않은 작업에는 완료 알림을 신청할 수 없습니다.");
      }
      if (!String(job.email || "").trim()) {
        throw new HttpError(
          409,
          "가입 이메일을 확인할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.",
          "ACCOUNT_EMAIL_REQUIRED",
        );
      }

      await tx`
        insert into shorts_mvp.user_email_notification_preferences (
          user_id,completion_email_status,decided_at
        ) values (
          ${session.userId},'enabled',clock_timestamp()
        )
        on conflict (user_id) do update
        set completion_email_status='enabled',
            decided_at=clock_timestamp()
      `;

      const initialStatus = job.status === "completed" ? "pending" : "waiting";
      const notifications = await tx`
        insert into shorts_mvp.job_completion_email_notifications (
          job_id,user_id,status,available_at
        ) values (
          ${jobId},${session.userId},${initialStatus},clock_timestamp()
        )
        on conflict (job_id) do update
        set status=case
              when job_completion_email_notifications.status in (
                'waiting','pending','processing','sent'
              )
                then job_completion_email_notifications.status
              else excluded.status
            end,
            attempt_count=case
              when job_completion_email_notifications.status='failed' then 0
              else job_completion_email_notifications.attempt_count
            end,
            available_at=case
              when job_completion_email_notifications.status='failed'
                then clock_timestamp()
              else job_completion_email_notifications.available_at
            end,
            claimed_at=case
              when job_completion_email_notifications.status='failed' then null
              else job_completion_email_notifications.claimed_at
            end,
            last_error=case
              when job_completion_email_notifications.status='failed' then null
              else job_completion_email_notifications.last_error
            end
        returning status
      `;
      return notifications[0];
    });

    const response = NextResponse.json({
      requested: true,
      status: notification.status,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error, "이메일 완료 알림을 신청하지 못했습니다.");
  }
}
