import type { Metadata } from "next";
import { EnterpriseLegalDocument } from "../../../enterprise-legal-document";

export const metadata: Metadata = { title: "기업용 취소 및 환불 정책 v1 | EasyCut" };

export default function EnterpriseRefundPolicyV1Page() {
  return <EnterpriseLegalDocument kind="refund-policy" />;
}
