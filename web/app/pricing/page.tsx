import type { Metadata } from "next";
import { getBillingSummary } from "@/lib/billing";
import {
  resolveBillingCustomerCohort,
  shouldUseTossBillingExperience,
} from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { authProfile, requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { loadTossBillingRuntimeState } from "@/lib/toss-billing-runtime";
import {
  getTossBillingState,
  publicTossCatalog,
  type TossBillingState,
} from "@/lib/toss-billing-state";
import type { TossCatalogPlan } from "@/lib/toss-subscription";
import { createPageMetadata } from "@/lib/seo";
import { PricingPageShell } from "./pricing-page-shell";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 제작 요금제·가격 | 이지컷",
  description: "이지컷 프로 월간 구독과 3·6·12개월 패키지, 얼리버드 추가시간을 확인하고 결제하세요.",
  path: "/pricing",
});

export default async function PricingPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? authProfile(user) : null;
  let initialState = null;
  let tossExperience = false;
  let initialTossState: TossBillingState | null = null;
  let guestTossCatalog: TossCatalogPlan[] | null = null;
  try {
    const db = getDb();
    const session = user
      ? await requireMvpSession(user, { createIfMissing: false })
      : null;
    const appUserId = session?.userId ?? null;
    if (!user) {
      const runtime = await loadTossBillingRuntimeState(db);
      tossExperience = runtime.effective.assignments && runtime.effective.charges;
      if (tossExperience) guestTossCatalog = publicTossCatalog();
    } else if (appUserId) {
      const cohort = await resolveBillingCustomerCohort(appUserId, db);
      tossExperience = shouldUseTossBillingExperience(cohort);
      if (tossExperience && session?.userId) {
        initialTossState = await getTossBillingState({
          userId: session.userId,
          session: session as typeof session & { userId: string },
          db,
        });
      }
    }
    initialState = {
      user: profile,
      billing: await getBillingSummary(db, appUserId),
    };
  } catch (error) {
    console.error("pricing_initial_state_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  return (
    <PricingPageShell
      user={profile}
      initialState={initialState}
      tossExperience={tossExperience}
      initialTossState={initialTossState}
      guestTossCatalog={guestTossCatalog}
    />
  );
}
