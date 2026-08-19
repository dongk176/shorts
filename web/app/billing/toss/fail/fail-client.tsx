"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function TossCheckoutFailClient() {
  const [message, setMessage] = useState("카드등록이 완료되지 않았습니다. 다시 시도해 주세요.");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerMessage = params.get("message");
    if (providerMessage && providerMessage.length <= 180) setMessage(providerMessage);
    window.history.replaceState(null, "", "/billing/toss/fail");
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#101415] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-10">
        <h1 className="text-3xl font-black tracking-tight">카드등록이 완료되지 않았습니다</h1>
        <p className="mt-4 text-sm leading-7 text-neutral-400">{message}</p>
        <Link href="/pricing" className="mt-8 grid min-h-13 place-items-center rounded-2xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] text-sm font-black text-white">다시 시도하기</Link>
      </section>
    </main>
  );
}
