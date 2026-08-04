import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "../2/purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 v5 | Easy Cut",
  description: "2026년 8월 3일부터 적용된 유료서비스 구매약관 v5 보관본입니다.",
  path: "/purchase-terms/versions/5",
});

export default function ArchivedPurchaseTermsV5Page() {
  return <PurchaseTermsV2Document archived version={5} />;
}
