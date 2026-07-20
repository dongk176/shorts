import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { getPublicMvpState, getRecentJobs } from "@/lib/data";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { currentKstPeriod, getUsageSnapshot, isPlanEnforcementEnabled } from "@/lib/usage";

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
      const selectedPlanCode = "free";
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
          baseUsedSeconds: 0,
          baseReservedSeconds: 0,
          baseLimitSeconds: 0,
          baseRemainingSeconds: 0,
          addonRemainingSeconds: 0,
          periodStart: start.toISOString(),
          nextResetAt: next.toISOString(),
          enforcementEnabled: isPlanEnforcementEnabled(),
        },
        billing: await getBillingSummary(db, null),
        recentJobs: [],
      }, { headers: { "x-request-id": requestId } });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const session = await requireMvpSession(authenticatedUser);
    const [usage, recentJobs, billing] = await Promise.all([
      getUsageSnapshot(db, session),
      getRecentJobs(db, session),
      getBillingSummary(db, session.userId),
    ]);
    const response = NextResponse.json(
      { sessionId: session.id, user: session.user, selectedPlanCode: billing.planCode, generatedShortCount, plans, billing, usage, recentJobs },
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
