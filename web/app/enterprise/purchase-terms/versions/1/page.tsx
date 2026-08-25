import type { Metadata } from "next";
import { EnterpriseLegalDocument } from "../../../enterprise-legal-document";

export const metadata: Metadata = { title: "기업용 서비스 구매 및 이용약관 v1 | EasyCut" };

export default function EnterprisePurchaseTermsV1Page() {
  return <EnterpriseLegalDocument kind="purchase-terms" />;
}
