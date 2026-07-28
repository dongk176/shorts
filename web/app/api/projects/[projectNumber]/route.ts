import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getProjectByNumber, getPublicExampleProjectByNumber } from "@/lib/data";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { billingSupportsPaidProjectActions } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
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
