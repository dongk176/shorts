import { NextResponse } from "next/server";
import { z } from "zod";
import { recordCreatorProjectShareCta } from "@/lib/creator-project-shares";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  viewRequestId: z.string().uuid(),
  ctaRequestId: z.string().uuid(),
});

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
    const recorded = await recordCreatorProjectShareCta({
      db: getDb(),
      token,
      sessionId: session.id,
      viewRequestId: input.viewRequestId,
      ctaRequestId: input.ctaRequestId,
    });
    if (!recorded) throw new HttpError(404, "전용 프로젝트를 찾을 수 없습니다.");
    const response = new NextResponse(null, { status: 204 });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
