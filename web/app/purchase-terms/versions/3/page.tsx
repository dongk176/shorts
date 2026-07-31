import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "../2/purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 v3 | Easy Cut",
  description: "수기결제 할부 적용 전 유료서비스 구매약관 v3 보관본입니다.",
  path: "/purchase-terms/versions/3",
});

export default function ArchivedPurchaseTermsV3Page() {
  return <PurchaseTermsV2Document archived version={3} />;
}
