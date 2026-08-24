import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "../2/purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 v7 | Easy Cut",
  description: "2026년 8월 18일부터 적용된 유료서비스 구매약관 v7 보관본입니다.",
  path: "/purchase-terms/versions/7",
});

export default function ArchivedPurchaseTermsV7Page() {
  return <PurchaseTermsV2Document archived version={7} />;
}
