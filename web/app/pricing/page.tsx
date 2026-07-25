import type { Metadata } from "next";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
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
  try {
    const db = getDb();
    const appUserRows = user
      ? await db`
          select id from shorts_mvp.app_users
          where auth_user_id=${user.id}
          limit 1
        `
      : [];
    const appUserId = typeof appUserRows[0]?.id === "string"
      ? appUserRows[0].id
      : null;
    initialState = {
      user: profile,
      billing: await getBillingSummary(db, appUserId),
    };
  } catch (error) {
    console.error("pricing_initial_state_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  return <PricingPageShell user={profile} initialState={initialState} />;
}
