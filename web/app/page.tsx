import type { Metadata } from "next";
import { StructuredData } from "@/components/structured-data";
import { createPageMetadata, DEFAULT_DESCRIPTION, SITE_URL } from "@/lib/seo";
import { ShortsApp } from "./shorts-app";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 자동 제작 | 유튜브 링크로 숏폼 만들기 - 이지컷",
  description: DEFAULT_DESCRIPTION,
  path: "/",
});

export default function Home() {
  const applicationData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${SITE_URL}/#application`,
    name: "이지컷(Easy Cut)",
    alternateName: ["이지컷", "Easy Cut", "쇼츠 AI"],
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    browserRequirements: "최신 웹 브라우저와 JavaScript가 필요합니다.",
    inLanguage: ["ko", "en", "ja", "zh-CN", "es", "fr", "de", "pt-BR"],
    featureList: [
      "YouTube 링크 기반 AI 하이라이트 추출",
      "30~60초 쇼츠 자동 제작",
      "자동 자막과 후킹 제목",
      "5가지 영상 비율",
      "4가지 쇼츠 템플릿",
      "제목과 자막 편집",
    ],
    offers: [
      { "@type": "Offer", name: "PLUS", price: "9900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
      { "@type": "Offer", name: "STANDARD", price: "19900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
      { "@type": "Offer", name: "PRO", price: "49900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
    ],
    provider: { "@id": `${SITE_URL}/#organization` },
  };
  return (
    <>
      <StructuredData data={applicationData} />
      <ShortsApp />
    </>
  );
}
