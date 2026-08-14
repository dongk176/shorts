import { NextResponse } from "next/server";
import { z } from "zod";
import { recordCreatorProjectShareVisit } from "@/lib/creator-project-shares";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ requestId: z.string().uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const [{ token }, input, session] = await Promise.all([
      context.params,
      request.json().then((value) => bodySchema.parse(value)),
      requireMvpSession(),
    ]);
    const recorded = await recordCreatorProjectShareVisit({
      db: getDb(),
      token,
      sessionId: session.id,
      requestId: input.requestId,
    });
    if (!recorded) throw new HttpError(404, "전용 프로젝트를 찾을 수 없습니다.");
    const response = new NextResponse(null, { status: 204 });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
