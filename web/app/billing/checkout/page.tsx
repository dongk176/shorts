import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isPricingV2PlanCode } from "@/lib/pricing-v2";
import { createNoIndexMetadata } from "@/lib/seo";
import { BillingCheckoutClient } from "./checkout-client";

export const metadata: Metadata = createNoIndexMetadata(
  "결제하기",
  "선택한 구독 또는 패키지 상품을 결제합니다.",
);

export default async function BillingCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const plan = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  if (
    mode === "renew_annual"
    || ((mode === "subscribe" || mode === "change_subscription") && !isPricingV2PlanCode(plan))
  ) {
    redirect("/pricing");
  }
  return <Suspense fallback={<main className="app-shell grid min-h-screen place-items-center text-neutral-400">결제 화면을 준비하고 있습니다...</main>}><BillingCheckoutClient /></Suspense>;
}
