"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "review"; message: string }
  | { kind: "error"; message: string };

type ConfirmationInput = {
  attemptId: string;
  paymentKey: string;
  orderId: string;
  amount: number;
};

function confirmationInput(params: URLSearchParams): ConfirmationInput | null {
  const attemptId = params.get("attemptId");
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));
  if (!attemptId || !paymentKey || !orderId || !Number.isSafeInteger(amount) || amount < 100) {
    return null;
  }
  return { attemptId, paymentKey, orderId, amount };
}

export function EnterprisePaymentSuccessClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storageKey = `enterprise-payment-confirm:${token}`;
    const fromUrl = confirmationInput(params);
    if (fromUrl) sessionStorage.setItem(storageKey, JSON.stringify(fromUrl));
    let input = fromUrl;
    if (!input) {
      try {
        input = JSON.parse(sessionStorage.getItem(storageKey) || "null") as ConfirmationInput | null;
      } catch {
        input = null;
      }
    }
    window.history.replaceState(null, "", `/enterprise-pay/${encodeURIComponent(token)}/success`);
    if (!input) {
      setStatus({ kind: "error", message: "결제 승인 정보를 확인할 수 없습니다." });
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/enterprise-pay/${encodeURIComponent(token)}/attempts/${encodeURIComponent(input.attemptId)}/confirm`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentKey: input.paymentKey,
          orderId: input.orderId,
          amount: input.amount,
        }),
      },
    ).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as {
        state?: string;
        message?: string;
        detail?: string;
      };
      if (response.status === 202 || payload.state === "manual_review") {
        setStatus({
          kind: "review",
          message: payload.message || "결제 결과를 안전하게 확인하고 있습니다. 다시 결제하지 마세요.",
        });
        return;
      }
      if (!response.ok || payload.state !== "succeeded") {
        throw new Error(payload.message || payload.detail || "결제를 완료하지 못했습니다.");
      }
      sessionStorage.removeItem(storageKey);
      setStatus({ kind: "success" });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "결제를 완료하지 못했습니다.",
      });
    });
    return () => controller.abort();
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0f1213] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 sm:p-10">
        {status.kind === "loading" ? (
          <>
            <div className="h-12 w-12 animate-pulse rounded-2xl bg-white/[.07]" />
            <h1 className="mt-6 text-2xl font-black">결제 결과를 확인하고 있습니다</h1>
            <p className="mt-3 text-sm leading-7 text-neutral-400">창을 닫지 말고 잠시만 기다려 주세요.</p>
          </>
        ) : status.kind === "success" ? (
          <>
            <span className="inline-flex rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-200">결제 완료</span>
            <h1 className="mt-5 text-3xl font-black tracking-tight">카드 결제가 완료되었습니다</h1>
            <p className="mt-4 text-sm leading-7 text-neutral-300">남은 결제 항목이 있다면 요청 화면에서 이어서 결제할 수 있습니다.</p>
            <Link href={`/enterprise-pay/${encodeURIComponent(token)}`} className="mt-8 flex min-h-14 items-center justify-center rounded-2xl bg-[#ff715e] px-5 text-base font-black text-white">결제 요청 확인</Link>
          </>
        ) : status.kind === "review" ? (
          <>
            <span className="inline-flex rounded-full bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">결과 확인 중</span>
            <h1 className="mt-5 text-3xl font-black tracking-tight">다시 결제하지 마세요</h1>
            <p className="mt-4 text-sm leading-7 text-neutral-300">{status.message}</p>
            <Link href={`/enterprise-pay/${encodeURIComponent(token)}`} className="mt-8 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 px-5 text-base font-black text-white">요청 화면으로 돌아가기</Link>
          </>
        ) : (
          <>
            <span className="inline-flex rounded-full bg-red-300/10 px-3 py-1 text-xs font-black text-red-200">확인 필요</span>
            <h1 className="mt-5 text-3xl font-black tracking-tight">결제를 완료하지 못했습니다</h1>
            <p className="mt-4 text-sm leading-7 text-red-100">{status.message}</p>
            <Link href={`/enterprise-pay/${encodeURIComponent(token)}`} className="mt-8 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 px-5 text-base font-black text-white">요청 화면으로 돌아가기</Link>
          </>
        )}
      </section>
    </main>
  );
}
