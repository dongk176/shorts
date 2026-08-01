import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  context: { params: Promise<{ projectNumber: string }> },
) {
  try {
    const { projectNumber: rawProjectNumber } = await context.params;
    if (!/^[1-9]\d*$/.test(rawProjectNumber)) {
      throw new HttpError(400, "올바른 프로젝트 번호가 아닙니다.");
    }
    const projectNumber = Number(rawProjectNumber);
    if (!Number.isSafeInteger(projectNumber)) {
      throw new HttpError(400, "올바른 프로젝트 번호가 아닙니다.");
    }

    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      update shorts_mvp.video_jobs
      set result_viewed_at=coalesce(result_viewed_at,clock_timestamp())
      where user_id=${session.userId}
        and project_number=${projectNumber}
        and not is_example
        and status='completed'
        and completed_at is not null
      returning result_viewed_at
    `;
    if (!rows[0]) {
      throw new HttpError(404, "확인할 수 있는 완료 프로젝트를 찾을 수 없습니다.");
    }

    const response = NextResponse.json({ viewed: true as const });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
