import type { Metadata } from "next";
import { EnterpriseLegalDocument } from "../enterprise-legal-document";

export const metadata: Metadata = { title: "기업용 서비스 구매 및 이용약관 | EasyCut" };

export default function EnterprisePurchaseTermsPage() {
  return <EnterpriseLegalDocument kind="purchase-terms" />;
}
