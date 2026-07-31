import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "./versions/2/purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 | Easy Cut",
  description: "이지컷 월간 구독, 기간 패키지 및 추가 처리시간 구매 조건을 안내합니다.",
  path: "/purchase-terms",
});

export default function PurchaseTermsPage() {
  return <PurchaseTermsV2Document archived={false} version={4} />;
}
