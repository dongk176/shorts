import type { Metadata } from "next";
import { Suspense } from "react";
import { createNoIndexMetadata } from "@/lib/seo";
import { BillingSuccessClient } from "./success-client";
import { BillingResult } from "./result";

export const metadata: Metadata = createNoIndexMetadata(
  "결제 완료",
  "이지컷 결제 결과를 확인하는 페이지입니다.",
);

export default function BillingSuccessPage() {
  return <Suspense fallback={<BillingResult status="결제 결과를 확인하고 있습니다..." />}><BillingSuccessClient /></Suspense>;
}
