import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { createNoIndexMetadata } from "@/lib/seo";
import { AccountActivity } from "./account-activity";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("내 결제·사용 내역", "Easy Cut 계정 활동 내역");

export default async function AccountActivityPage() {
  let session: Awaited<ReturnType<typeof requireAuthenticatedMvpSession>>;
  try {
    session = await requireAuthenticatedMvpSession({ createIfMissing: false });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/auth/sign-in?next=/account/activity");
    throw error;
  }
  return (
    <div className="app-shell site-chrome desktop-sidebar-layout flex min-h-screen flex-col text-neutral-100">
      <SiteHeader desktopSidebar><AuthControls user={session.user} next="/account/activity" /></SiteHeader>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-12 sm:px-8">
        <h1 className="mt-2 text-3xl font-black">내 결제·사용 내역</h1>
        <p className="mt-3 text-sm text-neutral-400">결제, 환불, 시간 지급과 작업별 사용·복구 기록을 확인할 수 있습니다.</p>
        <AccountActivity />
      </main>
      <SiteFooter />
    </div>
  );
}
