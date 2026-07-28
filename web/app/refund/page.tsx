import type { Metadata } from "next";
import { refundTranslations } from "@/lib/i18n/legal-translations";
import { getRequestLocale } from "@/lib/i18n/server";
import { createPageMetadata } from "@/lib/seo";
import { RefundPolicyV2Document } from "./versions/2/refund-policy-v2-document";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translated = locale === "ko" ? undefined : refundTranslations[locale];
  return createPageMetadata({
    title: `${translated?.title ?? "취소 및 환불 정책"} | Easy Cut`,
    description: translated?.description
      ?? "이지컷 월간 구독, 기간 패키지와 추가 처리시간의 취소 및 환불 기준을 안내합니다.",
    path: "/refund",
  });
}

export default function RefundPolicyPage() {
  return <RefundPolicyV2Document archived={false} version={3} />;
}
