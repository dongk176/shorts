import { NextResponse } from "next/server";
import { getProjectByNumber, getPublicExampleProjectByNumber } from "@/lib/data";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
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
      const response = NextResponse.json({ project: publicExample });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const session = await requireAuthenticatedMvpSession();
    const project = await getProjectByNumber(db, session, projectNumber);
    if (!project) throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");

    const response = NextResponse.json({ project });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
