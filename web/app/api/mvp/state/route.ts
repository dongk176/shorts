import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getGeneratedShortCount, getPlans, getRecentJobs } from "@/lib/data";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireMvpSession();
    const db = getDb();
    const [plans, usage, recentJobs, generatedShortCount] = await Promise.all([
      getPlans(db), getUsageSnapshot(db, session.id), getRecentJobs(db, session.id),
      getGeneratedShortCount(db),
    ]);
    return NextResponse.json({ sessionId: session.id, selectedPlanCode: session.selectedPlanCode, generatedShortCount, plans, usage, recentJobs });
  } catch (error) { return apiError(error); }
}
