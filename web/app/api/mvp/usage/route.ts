import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authenticatedUser = await getAuthenticatedUser();
    if (!authenticatedUser) {
      return NextResponse.json(
        { authenticated: false, accountId: null, usage: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const session = await requireMvpSession(authenticatedUser);
    const usage = await getUsageSnapshot(getDb(), session);
    return NextResponse.json(
      { authenticated: true, accountId: session.userId, usage },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = apiError(error, "남은 사용량을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
