import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { RefundPolicyV2Document } from "../2/refund-policy-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "취소 및 환불 정책 v3 | Easy Cut",
  description: "첫 유료 작업 완료 여부를 기준으로 계산하는 취소 및 환불 정책 v3 보관본입니다.",
  path: "/refund/versions/3",
});

export default function ArchivedRefundPolicyV3Page() {
  return <RefundPolicyV2Document archived version={3} />;
}
