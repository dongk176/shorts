import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "./purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 v2 | Easy Cut",
  description: "월별 배정형 기간 패키지에 적용되는 유료서비스 구매약관 v2 보관본입니다.",
  path: "/purchase-terms/versions/2",
});

export default function ArchivedPurchaseTermsV2Page() {
  return <PurchaseTermsV2Document />;
}
