import { createPageMetadata } from "@/lib/seo";
import { EnterpriseLegalDocument } from "../enterprise-legal-document";

export const metadata = createPageMetadata({
  title: "기업용 서비스 구매 및 이용약관 | 이지컷",
  description: "이지컷 기업용 서비스의 구매, 이용계약, 결제 및 이용 조건을 확인하세요.",
  path: "/enterprise/purchase-terms",
});

export default function EnterprisePurchaseTermsPage() {
  return <EnterpriseLegalDocument kind="purchase-terms" />;
}
