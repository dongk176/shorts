import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StructuredData } from "@/components/structured-data";
import { DEFAULT_DESCRIPTION, OG_IMAGE_PATH, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "AI 쇼츠 자동 제작 | 유튜브 링크로 숏폼 만들기 - 이지컷",
    template: "%s | 이지컷",
  },
  description: DEFAULT_DESCRIPTION,
  category: "technology",
  creator: "아티룸",
  publisher: "아티룸",
  authors: [{ name: "이지컷", url: SITE_URL }],
  referrer: "origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "AI 쇼츠 자동 제작 | 유튜브 링크로 숏폼 만들기 - 이지컷",
    description: DEFAULT_DESCRIPTION,
    images: [{
      url: OG_IMAGE_PATH,
      width: 1200,
      height: 630,
      alt: "이지컷 - 트렌드를 찾고 쇼츠로 선점하세요",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI 쇼츠 자동 제작 | 유튜브 링크로 숏폼 만들기 - 이지컷",
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
  icons: {
    icon: "/east-cut-logo.png",
    shortcut: "/east-cut-logo.png",
    apple: "/east-cut-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const websiteData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        alternateName: ["이지컷", "Easy Cut"],
        legalName: "아티룸",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/east-cut-logo.png`,
        },
        contactPoint: {
          "@type": "ContactPoint",
          telephone: "+82-10-4836-2874",
          email: "artiroom176@gmail.com",
          contactType: "customer support",
          availableLanguage: "Korean",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: ["이지컷", "Easy Cut"],
        description: DEFAULT_DESCRIPTION,
        inLanguage: "ko-KR",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <html lang="ko">
      <body>
        <StructuredData data={websiteData} />
        {children}
      </body>
    </html>
  );
}
