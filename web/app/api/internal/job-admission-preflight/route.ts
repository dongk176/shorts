import { NextResponse } from "next/server";
import {
  allProjectDispatchTargets,
  projectDispatchTargetsFingerprint,
} from "@/lib/job-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const targets = allProjectDispatchTargets();
    return NextResponse.json(
      {
        ready: true,
        targetCount: targets.length,
        fingerprint: projectDispatchTargetsFingerprint(targets),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("job_admission_preflight_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { ready: false, detail: "Job admission configuration is incomplete" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
