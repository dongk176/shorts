import { NextResponse } from "next/server";
import { getRecentJobs } from "@/lib/data";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const jobs = await getRecentJobs(db, session, jobId);
    if (!jobs[0]) throw new Error("작업을 찾을 수 없습니다.");
    return NextResponse.json({ job: jobs[0], usage: await getUsageSnapshot(db, session) });
  } catch (error) { return apiError(error); }
}
