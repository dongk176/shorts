"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function EnterprisePaymentFailClient({ token }: { token: string }) {
  const [message, setMessage] = useState("결제가 완료되지 않았습니다. 다시 시도해 주세요.");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const attemptId = params.get("attemptId");
    const code = (params.get("code") || "CHECKOUT_FAILED").slice(0, 100);
    const providerMessage = (params.get("message") || "결제창에서 결제가 완료되지 않았습니다.").slice(0, 300);
    setMessage(providerMessage);
    window.history.replaceState(null, "", `/enterprise-pay/${encodeURIComponent(token)}/fail`);
    if (!attemptId) return;
    void fetch(
      `/api/enterprise-pay/${encodeURIComponent(token)}/attempts/${encodeURIComponent(attemptId)}/fail`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, message: providerMessage }),
      },
    ).catch(() => undefined);
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0f1213] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 sm:p-10">
        <span className="inline-flex rounded-full bg-white/[.06] px-3 py-1 text-xs font-black text-neutral-300">결제 미완료</span>
        <h1 className="mt-5 text-3xl font-black tracking-tight">카드 결제가 완료되지 않았습니다</h1>
        <p className="mt-4 text-sm leading-7 text-neutral-300">{message}</p>
        <Link href={`/enterprise-pay/${encodeURIComponent(token)}`} className="mt-8 flex min-h-14 items-center justify-center rounded-2xl bg-[#ff715e] px-5 text-base font-black text-white">다시 결제하기</Link>
      </section>
    </main>
  );
}
