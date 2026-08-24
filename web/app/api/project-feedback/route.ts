import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  PROJECT_FEEDBACK_REWARD_SECONDS,
  PROJECT_FEEDBACK_REWARD_VALIDITY_DAYS,
  projectFeedbackSubmissionSchema,
} from "@/lib/project-feedback";
import { getProjectFeedbackPromptStatus } from "@/lib/project-feedback-store";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const response = NextResponse.json(
      await getProjectFeedbackPromptStatus(getDb(), session.userId),
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = projectFeedbackSubmissionSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();

    await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended(${`project-feedback:${session.userId}`},0)
        )
      `;
      const existingByRequest = await tx`
        select id
        from shorts_mvp.project_feedback_responses
        where user_id=${session.userId} and request_id=${input.requestId}
      `;
      if (existingByRequest[0]) return;

      const promptStatus = await getProjectFeedbackPromptStatus(tx, session.userId);
      if (promptStatus.submitted) {
        throw new HttpError(409, "피드백 보상은 계정당 한 번만 받을 수 있습니다.");
      }
      if (!promptStatus.eligible || promptStatus.promptCompletionCount === null) {
        throw new HttpError(409, "현재 피드백을 제출할 수 있는 시점이 아닙니다.");
      }

      const grantRows = await tx`
        insert into shorts_mvp.usage_grants (
          user_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,
          reserved_seconds,consumed_seconds,valid_from,expires_at,status
        ) values (
          ${session.userId},'addon','feedback_reward_30m',
          ${PROJECT_FEEDBACK_REWARD_SECONDS},${PROJECT_FEEDBACK_REWARD_SECONDS},0,0,0,
          clock_timestamp(),
          clock_timestamp() + ${PROJECT_FEEDBACK_REWARD_VALIDITY_DAYS} * interval '1 day',
          'active'
        )
        returning id
      `;
      await tx`
        insert into shorts_mvp.project_feedback_responses (
          user_id,request_id,satisfaction_rating,disappointment_reason,
          improvement_text,prompt_completion_count,completed_project_count,
          reward_seconds,reward_grant_id
        ) values (
          ${session.userId},${input.requestId},${input.satisfactionRating},
          ${input.disappointmentReason},${input.improvementText},
          ${promptStatus.promptCompletionCount},${promptStatus.completedProjectCount},
          ${PROJECT_FEEDBACK_REWARD_SECONDS},${grantRows[0].id}
        )
      `;
    });

    return NextResponse.json({
      submitted: true,
      rewardSeconds: PROJECT_FEEDBACK_REWARD_SECONDS,
      rewardValidityDays: PROJECT_FEEDBACK_REWARD_VALIDITY_DAYS,
      usage: await getUsageSnapshot(db, session),
    });
  } catch (error) {
    return apiError(error);
  }
}
