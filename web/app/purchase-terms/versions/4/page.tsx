import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";

import { PurchaseTermsV2Document } from "../2/purchase-terms-v2-document";

export async function generateMetadata() {
  return createLocalizedPageMetadata({
    title: "유료서비스 구매약관 v4 | Easy Cut",
    description: "환불정책 v3와 일회성 수기결제 할부 조건이 적용된 유료서비스 구매약관 v4 보관본입니다.",
    path: "/purchase-terms/versions/4",
  });
}

export default function ArchivedPurchaseTermsV4Page() {
  return <PurchaseTermsV2Document archived version={4} />;
}
