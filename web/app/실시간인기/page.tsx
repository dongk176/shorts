import type { Metadata } from "next";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
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
  return (
    <div className="app-shell site-chrome min-h-screen overflow-visible text-neutral-100">
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next="/popular" /></SiteHeader>
      <PopularVideosExplorer />
      <SiteFooter />
    </div>
  );
}
