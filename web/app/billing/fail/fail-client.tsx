"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function BillingFailClient() {
  const params = useSearchParams();
  const code = (params.get("code") || "PAYMENT_FAILED").slice(0, 80);
  const canceled = code === "PAY_PROCESS_CANCELED";
  return (
    <main className="app-shell grid min-h-screen place-items-center px-5 text-neutral-100">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191c1e] p-8 text-center shadow-2xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-xl font-black text-red-200">!</div>
        <h1 className="mt-5 text-2xl font-black">{canceled ? "결제가 취소되었습니다" : "결제를 완료하지 못했습니다"}</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-400">{canceled ? "결제는 승인되지 않았습니다. 원할 때 다시 시도할 수 있습니다." : `결제수단을 확인한 뒤 다시 시도해 주세요. (${code})`}</p>
        <Link href="/pricing" className="mt-7 flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-extrabold text-[#410000]">가격 페이지로 돌아가기</Link>
      </section>
    </main>
  );
}
