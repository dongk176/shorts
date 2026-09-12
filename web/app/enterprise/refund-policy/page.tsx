import { createPageMetadata } from "@/lib/seo";
import { EnterpriseLegalDocument } from "../enterprise-legal-document";

export const metadata = createPageMetadata({
  title: "기업용 취소 및 환불 정책 | 이지컷",
  description: "이지컷 기업용 서비스의 취소, 해지 및 환불 정책을 확인하세요.",
  path: "/enterprise/refund-policy",
});

export default function EnterpriseRefundPolicyPage() {
  return <EnterpriseLegalDocument kind="refund-policy" />;
}
