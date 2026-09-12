import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { allProjectDispatchTargets, projectDispatchTargetsFingerprint } from "@/lib/job-dispatch";
import { languageTestStatus, languageTestUnavailable } from "@/lib/language-test";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    // Each readiness result stands alone. A broken test never fails normal admission.
    let regular: { ready: boolean; fingerprint?: string };
    try { regular = { ready: true, fingerprint: projectDispatchTargetsFingerprint(allProjectDispatchTargets()) }; }
    catch { regular = { ready: false }; }
    const languageTest = await languageTestStatus(getDb())
      .then(({ enabled, ready, releaseId }) => ({ enabled, ready, releaseId }))
      .catch(() => ({ enabled: false, ready: false, releaseId: null }));
    return NextResponse.json({ regular, languageTest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const admin = await requireAdminUser();
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await request.json());
    await getDb().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('language_test_admission',0))`;
      await tx`select singleton from shorts_mvp.language_test_settings where singleton for update`;
      const state = await languageTestStatus(tx);
      if (enabled && !state.ready) throw languageTestUnavailable();
      await tx`update shorts_mvp.language_test_settings set enabled=${enabled},updated_at=now() where singleton`;
      await tx`insert into shorts_mvp.language_test_settings_audit(actor_id,enabled,release_id)
        values(${admin.id},${enabled},${state.releaseId || null})`;
    });
    return NextResponse.json({ enabled });
  } catch (error) { return apiError(error); }
}
