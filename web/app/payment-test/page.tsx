import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AuthControls } from "@/components/auth-controls";
import { isLocalHostname, isPaymentTesterEmail, isPaymentTestModeEnabled } from "@/lib/payment-test";
import type { AuthProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { PaymentTestClient } from "./payment-test-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "카드 등록 테스트 | Easy Cut",
  robots: { index: false, follow: false },
};

function requestHostname(host: string | null) {
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

function profileFromUser(user: Awaited<ReturnType<typeof getAuthenticatedUser>>): AuthProfile | null {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || null,
    displayName: typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string" ? metadata.name : null,
    avatarUrl: typeof metadata.avatar_url === "string"
      ? metadata.avatar_url
      : typeof metadata.picture === "string" ? metadata.picture : null,
  };
}

export default async function PaymentTestPage() {
  const requestHeaders = await headers();
  if (!isPaymentTestModeEnabled() || !isLocalHostname(requestHostname(requestHeaders.get("host")))) {
    notFound();
  }
  const profile = profileFromUser(await getAuthenticatedUser());
  const allowed = isPaymentTesterEmail(profile?.email);

  return (
    <div className="app-shell min-h-screen overflow-visible text-neutral-100">
      <header className="site-header">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Easy Cut 홈">
            <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
            <span className="brand-type">Easy <em>Cut</em></span>
          </Link>
          <AuthControls user={profile} next="/payment-test" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        {!profile ? (
          <section className="mx-auto max-w-xl rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-8 text-center shadow-2xl">
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#ff9b8d]">Local payment test</p>
            <h1 className="mt-4 text-3xl font-black tracking-[-.04em]">먼저 로그인해 주세요</h1>
            <p className="mt-4 text-sm leading-7 text-neutral-400">허용된 테스트 계정으로 로그인한 뒤 카드 등록 화면을 사용할 수 있습니다.</p>
          </section>
        ) : !allowed ? (
          <section className="mx-auto max-w-xl rounded-[24px] border border-amber-400/20 bg-[#191c1e]/90 p-8 text-center shadow-2xl">
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-amber-300">Access blocked</p>
            <h1 className="mt-4 text-3xl font-black tracking-[-.04em]">테스터 허용목록을 확인해 주세요</h1>
            <p className="mt-4 text-sm leading-7 text-neutral-400">
              현재 로그인 이메일을 <code className="rounded bg-black/30 px-1.5 py-1 text-neutral-200">PAYMENT_TESTER_EMAILS</code>에 추가하고 개발 서버를 다시 시작해야 합니다.
            </p>
          </section>
        ) : (
          <PaymentTestClient
            defaultName={profile.displayName || ""}
            defaultEmail={profile.email || ""}
          />
        )}
      </main>
    </div>
  );
}
