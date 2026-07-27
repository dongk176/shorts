import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { projectFeedbackDeferralSchema } from "@/lib/project-feedback";
import { getProjectFeedbackPromptStatus } from "@/lib/project-feedback-store";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const input = projectFeedbackDeferralSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();

    const status = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended(${`project-feedback:${session.userId}`},0)
        )
      `;
      const existingByRequest = await tx`
        select id
        from shorts_mvp.project_feedback_prompt_deferrals
        where user_id=${session.userId} and request_id=${input.requestId}
      `;
      if (existingByRequest[0]) {
        return getProjectFeedbackPromptStatus(tx, session.userId);
      }

      const currentStatus = await getProjectFeedbackPromptStatus(tx, session.userId);
      if (currentStatus.submitted || currentStatus.permanentlyDismissed) {
        return currentStatus;
      }
      if (!currentStatus.eligible || currentStatus.promptCompletionCount === null) {
        throw new HttpError(409, "현재 피드백을 미룰 수 있는 시점이 아닙니다.");
      }
      await tx`
        insert into shorts_mvp.project_feedback_prompt_deferrals (
          user_id,request_id,prompt_completion_count,completed_project_count
        ) values (
          ${session.userId},${input.requestId},
          ${currentStatus.promptCompletionCount},${currentStatus.completedProjectCount}
        )
      `;
      return getProjectFeedbackPromptStatus(tx, session.userId);
    });

    return NextResponse.json(status);
  } catch (error) {
    return apiError(error);
  }
}
