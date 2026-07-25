import type { Metadata } from "next";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { billingSupportsPopularFilters } from "@/lib/popular-entitlements";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createPageMetadata } from "@/lib/seo";
import { PopularVideosExplorer } from "./popular-videos-explorer";

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
        select id
        from shorts_mvp.app_users
        where auth_user_id=${user.id}
        limit 1
      `;
      const appUserId = typeof appUserRows[0]?.id === "string"
        ? appUserRows[0].id
        : null;
      if (appUserId) {
        canUseFilters = billingSupportsPopularFilters(
          await getBillingSummary(db, appUserId),
        );
      }
    } catch (error) {
      console.error("popular_filter_access_load_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return (
    <div className="app-shell site-chrome min-h-screen overflow-visible text-neutral-100">
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next="/popular" /></SiteHeader>
      <PopularVideosExplorer
        canUseFilters={canUseFilters}
        isAuthenticated={Boolean(user)}
      />
      <SiteFooter />
    </div>
  );
}
