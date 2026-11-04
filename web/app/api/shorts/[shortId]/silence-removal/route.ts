import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { requireShortsSilenceAccess } from "@/lib/shorts-silence-access";
import { processAdminShortSilence } from "@/lib/shorts-silence-processing";
import { apiError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(request: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const session = await requireAuthenticatedMvpSession(), db = getDb();
    await requireShortsSilenceAccess(db, session.userId);
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "이지컷 화면에서 다시 시도해 주세요.");
    const shortId = z.string().uuid().parse((await context.params).shortId);
    return NextResponse.json(await processAdminShortSilence(db, shortId, session.userId!));
  } catch (error) { return apiError(error); }
}
