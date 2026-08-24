import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { PurchaseTermsV2Document } from "../2/purchase-terms-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 v6 | Easy Cut",
  description: "선택한 원본 영상 구간을 기준으로 이용량을 계산하는 유료서비스 구매약관 v6 보관본입니다.",
  path: "/purchase-terms/versions/6",
});

export default function ArchivedPurchaseTermsV6Page() {
  return <PurchaseTermsV2Document archived version={6} />;
}
