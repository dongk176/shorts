import { NextResponse } from "next/server";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// 누적 재노출 이정표 3 → 6 → 12 → 24 → 48회를 만들기 위한 간격이다.
const SNOOZE_COMPLETION_DELAYS = [3, 3, 6, 12, 24, 48] as const;

function completionDelayForStep(step: number) {
  return SNOOZE_COMPLETION_DELAYS[
    Math.min(Math.max(0, step), SNOOZE_COMPLETION_DELAYS.length - 1)
  ];
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "이메일 알림 나중에 보기 요청");
    const session = await requireAuthenticatedMvpSession();
    const result = await getDb().begin(async (tx) => {
      const accountRows = await tx`
        select id
        from shorts_mvp.app_users
        where id=${session.userId}
          and withdrawn_at is null
        limit 1
        for update
      `;
      if (!accountRows[0]) {
        throw new HttpError(404, "회원 정보를 찾을 수 없습니다.");
      }

      const completedRows = await tx`
        select count(*)::integer as completed_job_count
        from shorts_mvp.video_jobs
        where user_id=${session.userId}
          and not is_example
          and status='completed'
      `;
      const snoozeRows = await tx`
        select snooze_step
        from shorts_mvp.email_preference_prompt_snoozes
        where user_id=${session.userId}
        limit 1
        for update
      `;
      const completedJobCount = Number(completedRows[0]?.completedJobCount || 0);
      const snoozeStep = Number(snoozeRows[0]?.snoozeStep || 0);
      const completionDelay = completionDelayForStep(snoozeStep);
      const nextPromptCompletedJobCount = completedJobCount + completionDelay;

      await tx`
        insert into shorts_mvp.email_preference_prompt_snoozes (
          user_id,snooze_step,completed_jobs_at_snooze,
          next_prompt_completed_job_count,snoozed_at
        ) values (
          ${session.userId},${snoozeStep + 1},${completedJobCount},
          ${nextPromptCompletedJobCount},clock_timestamp()
        )
        on conflict (user_id) do update
        set snooze_step=excluded.snooze_step,
            completed_jobs_at_snooze=excluded.completed_jobs_at_snooze,
            next_prompt_completed_job_count=excluded.next_prompt_completed_job_count,
            snoozed_at=clock_timestamp()
      `;

      return {
        deferred: true,
        completionDelay,
        nextPromptCompletedJobCount,
      };
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "이메일 알림을 나중에 표시하도록 설정하지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
