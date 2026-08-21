import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBillingSummary } from "@/lib/billing";
import {
  resolveBillingCustomerCohort,
  shouldUseTossBillingExperience,
} from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { authProfile } from "@/lib/session";
import { createNoIndexMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getTossBillingState } from "@/lib/toss-billing-state";
import { PlanManagementClient } from "./plan-management-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("요금제 관리", "이지컷 구독 및 요금제 관리");

export default async function PlanManagementPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in?next=/settings/plan");
  const session = await requireMvpSession(user, { createIfMissing: false });
  if (!session.userId) redirect("/settings");
  const db = getDb();
  const cohort = await resolveBillingCustomerCohort(session.userId, db);
  if (shouldUseTossBillingExperience(cohort)) {
    const state = await getTossBillingState({
      userId: session.userId,
      session: session as typeof session & { userId: string },
      db,
    });
    return <PlanManagementClient user={authProfile(user)} provider="toss" initialTossState={state} initialLegacyState={null} />;
  }
  return (
    <PlanManagementClient
      user={authProfile(user)}
      provider="thepayone"
      initialTossState={null}
      initialLegacyState={await getBillingSummary(db, session.userId)}
    />
  );
}
