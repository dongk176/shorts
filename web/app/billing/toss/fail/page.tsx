import type { Metadata } from "next";
import { createNoIndexMetadata } from "@/lib/seo";
import { TossCheckoutFailClient } from "./fail-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("구독 결제 실패", "이지컷 구독 결제 실패");

export default function TossCheckoutFailPage() {
  return <TossCheckoutFailClient />;
}
