import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { publicProjectAdmissionOpen } from "@/lib/project-admission-readiness";
import {
  allProjectDispatchTargets,
  projectDispatchTargetsFingerprint,
} from "@/lib/job-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const targets = allProjectDispatchTargets();
    const [state] = await getDb()`
      select render_v4_target_successor as operation
      from shorts_mvp.editor_release_state where singleton=true
    `;
    if (!state || !publicProjectAdmissionOpen(state.operation)) {
      return NextResponse.json(
        { ready: false, code: "INITIAL_RENDER_RELEASE_HANDOFF" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } },
      );
    }
    return NextResponse.json(
      {
        ready: true,
        publicAdmissionChecked: true,
        verificationScope: "configuration-and-public-handoff",
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
