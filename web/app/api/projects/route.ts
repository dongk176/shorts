import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureReadDbReady } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { loadProjectListPage } from "@/lib/project-list";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.string().max(2048).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) throw new HttpError(401, "로그인이 필요합니다.");
    await ensureReadDbReady();
    const url = new URL(request.url);
    const query = querySchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const session = await requireMvpSession(user, { createIfMissing: false });
    const page = await loadProjectListPage({ session, cursor: query.cursor });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "프로젝트를 더 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
