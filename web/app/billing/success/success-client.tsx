"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { billingPostJson } from "@/lib/billing-client";
import { BillingResult } from "./result";

export function BillingSuccessClient() {
  const params = useSearchParams();
  const started = useRef(false);
  const [result, setResult] = useState<{ message: string; error: boolean }>({
    message: "잠시만 기다려 주세요. 이 창을 닫지 마세요.",
    error: false,
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const flow = params.get("flow");
    const checkoutId = params.get("checkoutId");
    const task = async () => {
      if (!checkoutId) throw new Error("결제 요청 식별자가 없습니다.");
      if (flow === "subscription") {
        const authKey = params.get("authKey");
        const customerKey = params.get("customerKey");
        if (!authKey || !customerKey) throw new Error("정기결제 인증 결과가 없습니다.");
        await billingPostJson("/api/billing/activate", { checkoutId, authKey, customerKey });
        setResult({ message: "구독과 결제수단이 적용되었습니다.", error: false });
        return;
      }
      if (flow === "addon") {
        const paymentKey = params.get("paymentKey");
        const orderId = params.get("orderId");
        if (!paymentKey || !orderId) throw new Error("결제 승인 정보가 없습니다.");
        await billingPostJson("/api/billing/addons/confirm", { checkoutId, paymentKey, orderId });
        setResult({ message: "추가 처리시간이 계정에 충전되었습니다.", error: false });
        return;
      }
      throw new Error("지원하지 않는 결제 흐름입니다.");
    };
    void task().catch((cause) => setResult({
      message: cause instanceof Error ? cause.message : "결제 결과를 확인하지 못했습니다.",
      error: true,
    }));
  }, [params]);

  return <BillingResult status={result.message} error={result.error} />;
}
