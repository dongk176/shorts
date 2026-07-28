import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { RefundPolicyV2Document } from "./refund-policy-v2-document";

export const metadata: Metadata = createPageMetadata({
  title: "취소 및 환불 정책 v2 | Easy Cut",
  description: "월별 배정형 기간 패키지 주문에 적용되는 취소 및 환불 정책 v2 보관본입니다.",
  path: "/refund/versions/2",
});

export default function ArchivedRefundPolicyV2Page() {
  return <RefundPolicyV2Document />;
}
