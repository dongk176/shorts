import { NextResponse } from "next/server";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  emailPreferenceDecisionSchema,
  type JobCompletionEmailPreferenceStatus,
} from "@/lib/job-completion-preference";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select account.email,preference.notification_email,
             preference.completion_email_status,
             preference.marketing_email_status,
             prompt.next_prompt_completed_job_count,
             (
               select count(*)::integer
               from shorts_mvp.video_jobs job
               where job.user_id=account.id
                 and not job.is_example
                 and job.status='completed'
             ) as completed_job_count
      from shorts_mvp.app_users account
      left join shorts_mvp.user_email_notification_preferences preference
        on preference.user_id=account.id
      left join shorts_mvp.email_preference_prompt_snoozes prompt
        on prompt.user_id=account.id
      where account.id=${session.userId}
        and account.withdrawn_at is null
      limit 1
    `;
    const account = rows[0];
    if (!account) throw new HttpError(404, "회원 정보를 찾을 수 없습니다.");
    const status: JobCompletionEmailPreferenceStatus =
      account.completionEmailStatus === "enabled"
      || account.completionEmailStatus === "declined"
        ? account.completionEmailStatus
        : "not_asked";
    const marketingStatus: JobCompletionEmailPreferenceStatus =
      account.marketingEmailStatus === "enabled"
      || account.marketingEmailStatus === "declined"
        ? account.marketingEmailStatus
        : "not_asked";
    const completedJobCount = Number(account.completedJobCount || 0);
    const nextPromptCompletedJobCount =
      account.nextPromptCompletedJobCount === null
      || account.nextPromptCompletedJobCount === undefined
        ? null
        : Number(account.nextPromptCompletedJobCount);
    const hasPendingDecision =
      status === "not_asked" || marketingStatus === "not_asked";
    return noStoreJson({
      status,
      marketingStatus,
      email: String(account.notificationEmail || account.email || "").trim() || null,
      promptDue: hasPendingDecision && (
        nextPromptCompletedJobCount === null
        || completedJobCount >= nextPromptCompletedJobCount
      ),
      completedJobCount,
      nextPromptCompletedJobCount,
    });
  } catch (error) {
    const response = apiError(error, "완료 알림 설정을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "완료 알림 설정 요청");
    const input = emailPreferenceDecisionSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await getDb().begin(async (tx) => {
      const accountRows = await tx`
        select account.email,
               (
                 select preference.notification_email
                 from shorts_mvp.user_email_notification_preferences preference
                 where preference.user_id=account.id
               ) as notification_email
        from shorts_mvp.app_users account
        where account.id=${session.userId}
          and account.withdrawn_at is null
        limit 1
        for update
      `;
      if (!accountRows[0]) throw new HttpError(404, "회원 정보를 찾을 수 없습니다.");
      const accountEmail = String(accountRows[0].email || "").trim().toLowerCase();
      const existingNotificationEmail =
        String(accountRows[0].notificationEmail || "").trim().toLowerCase() || null;
      const notificationEmail = input.email === undefined
        ? existingNotificationEmail
        : input.email === accountEmail
          ? null
          : input.email;
      const email = notificationEmail || accountEmail;
      if (
        (input.status === "enabled" || input.marketingStatus === "enabled")
        && !email
      ) {
        throw new HttpError(
          409,
          "이메일 주소를 확인할 수 없습니다. 주소를 입력한 뒤 다시 시도해 주세요.",
          "ACCOUNT_EMAIL_REQUIRED",
        );
      }

      const preferenceRows = await tx`
        insert into shorts_mvp.user_email_notification_preferences (
          user_id,completion_email_status,decided_at,
          marketing_email_status,marketing_decided_at,notification_email
        ) values (
          ${session.userId},${input.status},clock_timestamp(),
          ${input.marketingStatus},clock_timestamp(),${notificationEmail}
        )
        on conflict (user_id) do update
        set completion_email_status=excluded.completion_email_status,
            decided_at=case
              when user_email_notification_preferences.completion_email_status
                is distinct from excluded.completion_email_status
                then clock_timestamp()
              else user_email_notification_preferences.decided_at
            end,
            marketing_email_status=excluded.marketing_email_status,
            marketing_decided_at=case
              when user_email_notification_preferences.marketing_email_status
                is distinct from excluded.marketing_email_status
                then clock_timestamp()
              else user_email_notification_preferences.marketing_decided_at
            end,
            notification_email=excluded.notification_email
        returning completion_email_status,marketing_email_status
      `;

      if (input.status === "enabled") {
        await tx`
          insert into shorts_mvp.job_completion_email_notifications (
            job_id,user_id,status,available_at
          )
          select job.id,job.user_id,'waiting',clock_timestamp()
          from shorts_mvp.video_jobs job
          where job.user_id=${session.userId}
            and not job.is_example
            and job.status in (
              'validating','queued','starting','downloading','transcribing',
              'selecting','extracting','rendering','uploading','retry_waiting'
            )
          on conflict (job_id) do nothing
        `;
      }

      await tx`
        delete from shorts_mvp.email_preference_prompt_snoozes
        where user_id=${session.userId}
      `;

      return {
        status: preferenceRows[0].completionEmailStatus,
        marketingStatus: preferenceRows[0].marketingEmailStatus,
        email: email || null,
        promptDue: false,
      };
    });

    return noStoreJson(result);
  } catch (error) {
    const response = apiError(error, "완료 알림 설정을 저장하지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
