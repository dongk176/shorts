"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "review"; message: string }
  | { kind: "error"; message: string };

export function EnterpriseBillingSuccessClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const intentId = params.get("intentId");
    const authKey = params.get("authKey");
    const customerKey = params.get("customerKey");
    window.history.replaceState(
      null,
      "",
      `/enterprise-pay/${encodeURIComponent(token)}/billing/success`,
    );
    if (!intentId || !authKey || !customerKey) {
      setStatus({ kind: "error", message: "카드등록 결과 정보가 누락되었습니다." });
      return;
    }
    void fetch(
      `/api/enterprise-pay/${encodeURIComponent(token)}/billing/registration/complete`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, authKey, customerKey }),
      },
    ).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as {
        state?: string;
        detail?: string;
      };
      if (response.status === 202 || payload.state === "manual_review") {
        setStatus({
          kind: "review",
          message: "카드등록 또는 결제 결과를 확인하고 있습니다. 다시 결제하지 마세요.",
        });
        return;
      }
      if (!response.ok || payload.state !== "succeeded") {
        throw new Error(payload.detail || "카드등록과 결제를 완료하지 못했습니다.");
      }
      setStatus({ kind: "success" });
    }).catch((cause) => {
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "결제 결과를 확인하지 못했습니다.",
      });
    });
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0f1213] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-10">
        {status.kind === "loading" ? (
          <><h1 className="text-2xl font-black">카드등록과 결제를 확인하고 있습니다</h1><p className="mt-3 text-sm leading-7 text-neutral-400">창을 닫지 말고 잠시만 기다려 주세요.</p></>
        ) : status.kind === "success" ? (
          <><span className="inline-flex rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-200">결제 완료</span><h1 className="mt-5 text-3xl font-black">첫 결제가 완료되었습니다</h1><p className="mt-4 text-sm leading-7 text-neutral-300">카드가 안전하게 등록되었습니다. 남은 상품은 각각 금액을 확인한 뒤 결제할 수 있습니다.</p></>
        ) : status.kind === "review" ? (
          <><span className="inline-flex rounded-full bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">결과 확인 중</span><h1 className="mt-5 text-3xl font-black">다시 결제하지 마세요</h1><p className="mt-4 text-sm leading-7 text-neutral-300">{status.message}</p></>
        ) : (
          <><span className="inline-flex rounded-full bg-red-300/10 px-3 py-1 text-xs font-black text-red-200">확인 필요</span><h1 className="mt-5 text-3xl font-black">완료하지 못했습니다</h1><p className="mt-4 text-sm leading-7 text-red-100">{status.message}</p></>
        )}
        {status.kind !== "loading" ? <Link href={`/enterprise-pay/${encodeURIComponent(token)}`} className="mt-8 flex min-h-14 items-center justify-center rounded-2xl bg-[#ff715e] px-5 text-base font-black text-white">결제 요청으로 돌아가기</Link> : null}
      </section>
    </main>
  );
}
