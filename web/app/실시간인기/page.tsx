import type { Metadata } from "next";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import {
  billingSupportsPopularFilters,
  hasDirectPopularFilterAccess,
  managedPopularFilterOverride,
} from "@/lib/popular-entitlements";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createPageMetadata } from "@/lib/seo";
import { PopularPageShell } from "./popular-page-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "유튜브 실시간 인기 영상·쇼츠 소재 찾기 | 이지컷",
  description: "지금 떠오르는 유튜브 인기 영상을 확인하고 재사용, 길이, 카테고리별로 쇼츠 소재를 찾아보세요.",
  path: "/popular",
});

export default async function PopularVideosPage() {
  const user = await getAuthenticatedUser();
  let canUseFilters = false;
  if (user) {
    try {
      const db = getDb();
      const appUserRows = await db`
        select account.id
        from shorts_mvp.app_users account
        where account.auth_user_id=${user.id}
        limit 1
      `;
      const appUserId = typeof appUserRows[0]?.id === "string"
        ? appUserRows[0].id
        : null;
      if (appUserId) {
        const [billing, directAccess, managedOverride] = await Promise.all([
          getBillingSummary(db, appUserId),
          hasDirectPopularFilterAccess(db, appUserId),
          managedPopularFilterOverride(db, appUserId),
        ]);
        canUseFilters = billingSupportsPopularFilters(
          billing,
          directAccess,
          managedOverride,
        );
      }
    } catch (error) {
      console.error("popular_filter_access_load_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return (
    <PopularPageShell
      user={user ? authProfile(user) : null}
      canUseFilters={canUseFilters}
    />
  );
}
