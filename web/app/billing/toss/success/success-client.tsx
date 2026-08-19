"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "success"; remainingMinutes: number }
  | { kind: "error"; message: string };

export function TossCheckoutSuccessClient() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get("requestId");
    const customerKey = params.get("customerKey");
    const authKey = params.get("authKey");
    window.history.replaceState(null, "", "/billing/toss/success");

    if (!requestId || !customerKey || !authKey) {
      setStatus({ kind: "error", message: "카드등록 결과를 확인할 수 없습니다. 요금제에서 다시 시도해 주세요." });
      return;
    }

    const controller = new AbortController();
    fetch("/api/billing/toss/checkout/complete", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, customerKey, authKey }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { remainingSeconds?: number; detail?: string };
      if (!response.ok) throw new Error(payload.detail || "결제를 완료하지 못했습니다.");
      setStatus({ kind: "success", remainingMinutes: Math.max(0, Math.floor((payload.remainingSeconds ?? 0) / 60)) });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setStatus({ kind: "error", message: cause instanceof Error ? cause.message : "결제를 완료하지 못했습니다." });
    });
    return () => controller.abort();
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#101415] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-10">
        {status.kind === "loading" ? (
          <>
            <div className="h-12 w-12 animate-pulse rounded-2xl bg-white/[.07]" />
            <h1 className="mt-6 text-2xl font-black">구독을 시작하고 있습니다</h1>
            <p className="mt-3 text-sm leading-7 text-neutral-400">창을 닫지 말고 잠시만 기다려 주세요.</p>
          </>
        ) : status.kind === "success" ? (
          <>
            <h1 className="text-3xl font-black tracking-tight">구독이 시작되었습니다</h1>
            <p className="mt-4 text-base font-bold text-neutral-200">남은 사용량 {status.remainingMinutes}분</p>
            <p className="mt-2 text-sm leading-7 text-neutral-400">등록한 카드로 다음 결제일에 자동 결제됩니다.</p>
            <Link href="/projects" className="mt-8 grid min-h-13 place-items-center rounded-2xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] text-sm font-black text-white">쇼츠 만들기</Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-black tracking-tight">결제를 완료하지 못했습니다</h1>
            <p className="mt-4 text-sm leading-7 text-red-200">{status.message}</p>
            <Link href="/pricing" className="mt-8 grid min-h-13 place-items-center rounded-2xl border border-white/12 text-sm font-black text-white">요금제로 돌아가기</Link>
          </>
        )}
      </section>
    </main>
  );
}
