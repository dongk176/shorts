import type { Metadata } from "next";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { getDb } from "@/lib/db";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { PopularVideosExplorer } from "./popular-videos-explorer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "실시간 인기 영상 | Easy Cut",
  description: "지금 떠오르는 영상을 놓치지 마세요. 구독 회원에게는 콘텐츠가 6시간 먼저 공개됩니다.",
};

export default async function PopularVideosPage() {
  const user = await getAuthenticatedUser();
  const planRows = user
    ? await getDb()`select selected_plan_code from shorts_mvp.app_users where auth_user_id=${user.id} limit 1`
    : [];
  const hasProAccess = planRows[0]?.selectedPlanCode === "pro";
  return (
    <div className="app-shell min-h-screen overflow-visible text-neutral-100">
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next="/실시간인기" /></SiteHeader>
      <PopularVideosExplorer hasProAccess={hasProAccess} isAuthenticated={Boolean(user)} />
      <footer className="site-footer">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div><span className="brand-type">Easy <em>Cut</em></span><p className="mt-2 text-xs text-neutral-500">© 2026 Easy Cut. 아카이브를 바이럴 콘텐츠로 변환하세요.</p></div>
            <div className="flex flex-wrap gap-6 text-xs text-neutral-400"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/support">고객 지원</Link></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
