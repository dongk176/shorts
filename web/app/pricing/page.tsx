import type { Metadata } from "next";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createPageMetadata } from "@/lib/seo";
import { PricingCards } from "./pricing-cards";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 제작 요금제·가격 | 이지컷",
  description: "이지컷 AI 쇼츠 자동 제작 요금제를 확인하세요. 월 100분부터 600분까지, 동시 작업과 프로젝트 보관기간에 맞춰 선택할 수 있습니다.",
  path: "/pricing",
});

export default async function PricingPage() {
  const user = await getAuthenticatedUser();
  return (
    <div className="app-shell site-chrome pricing-page min-h-screen text-neutral-100">
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next="/pricing" /></SiteHeader>
      <main className="pricing-main">
        <PricingCards />
        <p className="pricing-note">연간 플랜은 12개월 금액을 한 번에 결제합니다. 별도 유료 애드온은 연간 할인 대상에서 제외됩니다.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
