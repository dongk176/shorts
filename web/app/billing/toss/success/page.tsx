import type { Metadata } from "next";
import { createNoIndexMetadata } from "@/lib/seo";
import { TossCheckoutSuccessClient } from "./success-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("구독 결제 확인", "이지컷 구독 결제 확인");

export default function TossCheckoutSuccessPage() {
  return <TossCheckoutSuccessClient />;
}
