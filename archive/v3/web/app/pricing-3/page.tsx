import type { Metadata } from "next";
import { authProfile } from "@/lib/session";
import { createPageMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { PricingThreePageShell } from "./pricing-three-page-shell";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 사용량 패키지 | 이지컷",
  description: "자동결제 없이 X3·X6 사용량을 한 번에 받고 12개월 동안 이용하는 이지컷 패키지를 확인하세요.",
  path: "/pricing-3",
});

export default async function PricingThreePage() {
  const user = await getAuthenticatedUser();
  const profile = user ? authProfile(user) : null;

  return <PricingThreePageShell user={profile} />;
}
