import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getProjectByNumber, getPublicExampleProjectByNumber } from "@/lib/data";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { billingSupportsPaidProjectActions } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function parseProjectNumber(rawProjectNumber: string) {
  if (!/^[1-9]\d*$/.test(rawProjectNumber)) {
    throw new HttpError(400, "올바른 프로젝트 번호가 아닙니다.");
  }
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) {
    throw new HttpError(400, "올바른 프로젝트 번호가 아닙니다.");
  }
  return projectNumber;
}

export async function GET(
  _: Request,
  context: { params: Promise<{ projectNumber: string }> },
) {
  try {
    const { projectNumber: rawProjectNumber } = await context.params;
    const projectNumber = parseProjectNumber(rawProjectNumber);

    const db = getDb();
    const publicExample = await getPublicExampleProjectByNumber(db, projectNumber);
    if (publicExample) {
      const response = NextResponse.json({
        project: publicExample,
        access: { canEdit: false, canDownload: false },
      });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const session = await requireAuthenticatedMvpSession();
    const [project, billing] = await Promise.all([
      getProjectByNumber(db, session, projectNumber),
      getBillingSummary(db, session.userId),
    ]);
    if (!project) throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");
    const hasPaidAccess = billingSupportsPaidProjectActions(billing);

    const response = NextResponse.json({
      project,
      access: {
        canEdit: hasPaidAccess,
        canDownload: hasPaidAccess,
      },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ projectNumber: string }> },
) {
  try {
    const { projectNumber: rawProjectNumber } = await context.params;
    const projectNumber = parseProjectNumber(rawProjectNumber);
    const session = await requireAuthenticatedMvpSession({
      allowPaymentMethodRemediation: true,
      createIfMissing: false,
    });
    const db = getDb();

    const result = await db.begin(async (tx) => {
      const rows = await tx`
        select j.id, j.status, j.user_deleted_at, exists(
          select 1
          from shorts_mvp.generated_shorts s
          where s.job_id=j.id and s.deleted_at is null
            and s.status in ('rendering','rerendering')
        ) as has_active_outputs
        from shorts_mvp.video_jobs j
        where j.project_number=${projectNumber}
          and j.user_id=${session.userId}
          and not j.is_example
        limit 1
        for update of j
      `;
      const project = rows[0];
      if (!project) {
        throw new HttpError(404, "삭제할 프로젝트를 찾을 수 없습니다.");
      }
      if (project.userDeletedAt) {
        return { alreadyDeleted: true };
      }
      if (
        !["completed", "failed", "expired"].includes(String(project.status))
        || Boolean(project.hasActiveOutputs)
      ) {
        throw new HttpError(
          409,
          "진행 중인 작업은 완료된 뒤 삭제할 수 있습니다.",
          "PROJECT_DELETE_IN_PROGRESS",
        );
      }

      await tx`
        update shorts_mvp.video_jobs
        set user_deleted_at=coalesce(user_deleted_at, now())
        where id=${project.id} and user_deleted_at is null
      `;

      return { alreadyDeleted: false };
    });

    const response = NextResponse.json({ deleted: true, ...result });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
