import type { Metadata } from "next";
import { Suspense } from "react";
import { createNoIndexMetadata } from "@/lib/seo";
import { BillingFailClient } from "./fail-client";

export const metadata: Metadata = createNoIndexMetadata(
  "결제 실패",
  "이지컷 결제 실패 내용을 확인하는 페이지입니다.",
);

export default function BillingFailPage() {
  return <Suspense fallback={null}><BillingFailClient /></Suspense>;
}
