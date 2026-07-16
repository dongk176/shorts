import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPublicMvpState, getRecentJobs } from "@/lib/data";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { currentKstPeriod, getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    const db = getDb();
    const [{ plans, generatedShortCount }, authenticatedUser] = await Promise.all([
      getPublicMvpState(db),
      getAuthenticatedUser(),
    ]);
    if (!authenticatedUser) {
      const selectedPlanCode = "plus";
      const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode);
      if (!selectedPlan) throw new Error("기본 플랜 정보를 찾을 수 없습니다.");
      const { start, next } = currentKstPeriod();
      const response = NextResponse.json({
        sessionId: null,
        user: null,
        selectedPlanCode,
        generatedShortCount,
        plans,
        usage: {
          usedSeconds: 0,
          reservedSeconds: 0,
          limitSeconds: selectedPlan.monthlySourceSeconds,
          remainingSeconds: selectedPlan.monthlySourceSeconds,
          periodStart: start.toISOString(),
          nextResetAt: next.toISOString(),
          enforcementEnabled: process.env.MVP_PLAN_ENFORCEMENT === "true",
        },
        recentJobs: [],
      }, { headers: { "x-request-id": requestId } });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const session = await requireMvpSession(authenticatedUser);
    const [usage, recentJobs] = await Promise.all([
      getUsageSnapshot(db, session),
      getRecentJobs(db, session),
    ]);
    const response = NextResponse.json(
      { sessionId: session.id, user: session.user, selectedPlanCode: session.selectedPlanCode, generatedShortCount, plans, usage, recentJobs },
      { headers: { "x-request-id": requestId } },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorCode = typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code).slice(0, 32)
      : undefined;
    console.error("mvp_state_load_failed", { requestId, errorName, errorCode });
    const response = apiError(error);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
