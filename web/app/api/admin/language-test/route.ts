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
      .then(({ enabled, publicEnabled, ready, releaseId }) => ({ enabled, publicEnabled, ready, releaseId }))
      .catch(() => ({ enabled: false, publicEnabled: false, ready: false, releaseId: null, unavailable: true }));
    return NextResponse.json({ regular, languageTest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const admin = await requireAdminUser();
    const input = z.object({ enabled: z.boolean().optional(), publicEnabled: z.boolean().optional() })
      .strict().refine((v) => v.enabled !== undefined || v.publicEnabled !== undefined).parse(await request.json());
    const saved = await getDb().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('language_test_admission',0))`;
      await tx`select singleton from shorts_mvp.language_test_settings where singleton for update`;
      const state = await languageTestStatus(tx);
      const enabled = input.enabled ?? state.enabled;
      const publicEnabled = input.publicEnabled ?? state.publicEnabled;
      if ((input.publicEnabled === true && (!enabled || !state.ready))
        || (input.enabled === true && !state.ready)) throw languageTestUnavailable();
      const percent = publicEnabled ? 100 : 0;
      await tx`update shorts_mvp.language_test_settings set enabled=${enabled},
        public_rollout_percent=${percent},updated_at=now() where singleton`;
      await tx`insert into shorts_mvp.language_test_settings_audit(actor_id,enabled,public_rollout_percent,release_id)
        values(${admin.id},${enabled},${percent},${state.releaseId || null})`;
      return { enabled, publicEnabled, releaseId: state.releaseId };
    });
    return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
