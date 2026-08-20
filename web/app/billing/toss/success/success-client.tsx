"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUsageState } from "@/components/usage-provider";

type Status =
  | { kind: "loading" }
  | { kind: "pending"; message: string }
  | { kind: "success"; remainingMinutes: number }
  | { kind: "error"; message: string };

type CheckoutPayload = {
  state?: "succeeded" | "failed" | "reconciliation_required" | "pending" | "manual_review";
  remainingSeconds?: number;
  message?: string;
  detail?: string;
};

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export function TossCheckoutSuccessClient() {
  const router = useRouter();
  const { refreshUsage } = useUsageState();
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get("requestId");
    const customerKey = params.get("customerKey");
    const authKey = params.get("authKey");
    if (requestId) {
      window.history.replaceState(
        null,
        "",
        `/billing/toss/success?requestId=${encodeURIComponent(requestId)}`,
      );
    }

    if (!requestId) {
      setStatus({ kind: "error", message: "카드등록 결과를 확인할 수 없습니다. 요금제에서 다시 시도해 주세요." });
      return;
    }

    const controller = new AbortController();
    const finish = async (payload: CheckoutPayload) => {
      const remainingMinutes = Math.max(0, Math.floor((payload.remainingSeconds ?? 0) / 60));
      await refreshUsage().catch(() => undefined);
      router.refresh();
      setStatus({ kind: "success", remainingMinutes });
    };
    const statusRequest = async () => {
      const response = await fetch("/api/billing/toss/checkout/status", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const payload = await response.json().catch(() => ({})) as CheckoutPayload;
      if (!response.ok) throw new Error(payload.detail || "결제 상태를 확인하지 못했습니다.");
      return payload;
    };
    const poll = async () => {
      setStatus({
        kind: "pending",
        message: "추가 승인 없이 기존 주문의 결제 결과를 확인하고 있습니다.",
      });
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const payload = await statusRequest();
        if (payload.state === "succeeded") return finish(payload);
        if (payload.state === "failed") {
          throw new Error(payload.message || "카드 승인이 완료되지 않았습니다. 다시 시도해 주세요.");
        }
        if (payload.state === "manual_review") {
          setStatus({
            kind: "pending",
            message: "결제 내역을 안전하게 확인 중입니다. 다시 결제하지 마세요.",
          });
          return;
        }
        await wait(2_000, controller.signal);
      }
      setStatus({
        kind: "pending",
        message: "결제 내역을 계속 확인 중입니다. 다시 결제하지 마세요.",
      });
    };
    const run = async () => {
      if (!customerKey || !authKey) return poll();
      const response = await fetch("/api/billing/toss/checkout/complete", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, customerKey, authKey }),
      });
      const payload = await response.json().catch(() => ({})) as CheckoutPayload;
      if (response.status === 202 || payload.state === "reconciliation_required") return poll();
      if (!response.ok || payload.state === "failed") {
        throw new Error(payload.message || payload.detail || "결제를 완료하지 못했습니다.");
      }
      if (payload.state !== "succeeded") return poll();
      return finish(payload);
    };
    void run().catch((cause) => {
      if (controller.signal.aborted) return;
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "결제를 완료하지 못했습니다.",
      });
    });
    return () => controller.abort();
  }, [refreshUsage, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#101415] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#191d1e] p-7 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-10">
        {status.kind === "loading" || status.kind === "pending" ? (
          <>
            <div className="h-12 w-12 animate-pulse rounded-2xl bg-white/[.07]" />
            <h1 className="mt-6 text-2xl font-black">결제 결과를 확인하고 있습니다</h1>
            <p className="mt-3 text-sm leading-7 text-neutral-400">
              {status.kind === "pending" ? status.message : "창을 닫지 말고 잠시만 기다려 주세요."}
            </p>
          </>
        ) : status.kind === "success" ? (
          <>
            <h1 className="text-3xl font-black tracking-tight">구독이 시작되었습니다</h1>
            <p className="mt-4 text-base font-bold text-neutral-200">남은 사용량 {status.remainingMinutes}분</p>
            <Link href="/" className="mt-8 flex min-h-[56px] items-center justify-center rounded-2xl bg-gradient-to-r from-[#f84b3f] to-[#8b5cf6] px-5 text-base font-black text-white">쇼츠 만들기</Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-black tracking-tight">결제를 완료하지 못했습니다</h1>
            <p className="mt-4 text-sm leading-7 text-red-200">{status.message}</p>
            <Link href="/pricing" className="mt-8 flex min-h-[56px] items-center justify-center rounded-2xl border border-white/12 px-5 text-base font-black text-white">요금제로 돌아가기</Link>
          </>
        )}
      </section>
    </main>
  );
}
