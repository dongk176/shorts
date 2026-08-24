import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { createNoIndexMetadata } from "@/lib/seo";
import { PartnerLoginForm } from "./partner-login-form";

export const metadata: Metadata = createNoIndexMetadata(
  "파트너 로그인",
  "Easy Cut 레퍼럴 파트너 전용 로그인입니다.",
);

export default async function PartnerLoginPage() {
  const session = await getPartnerSession();
  if (session) redirect("/partner/dashboard");
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d0f10] px-5 py-14 text-neutral-100">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <p className="text-xs font-black uppercase tracking-[.24em] text-[#ff9585]">Easy Cut Partner</p>
          <h1 className="mt-3 text-3xl font-black">파트너 로그인</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            어드민에서 발급받은 아이디와 비밀번호를 입력해 주세요.
          </p>
        </div>
        <PartnerLoginForm />
        <p className="mt-5 text-center text-xs text-neutral-600">
          <Link href="/partner/terms" className="underline underline-offset-4">레퍼럴 파트너 운영 약관</Link>
        </p>
      </div>
    </main>
  );
}
