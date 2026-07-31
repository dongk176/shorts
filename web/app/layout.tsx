import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EditorLaunchAnnouncementOverlay } from "@/components/editor-launch-announcement-overlay";
import { FirebaseAnalytics } from "@/components/google-analytics";
import { StructuredData } from "@/components/structured-data";
import { LanguageSelector } from "@/components/language-selector";
import { ProjectFeedbackOverlay } from "@/components/project-feedback-overlay";
import { UserOnboardingOverlay } from "@/components/user-onboarding-overlay";
import { UsageProvider, type UsageState } from "@/components/usage-provider";
import { getDb } from "@/lib/db";
import { I18nProvider } from "@/lib/i18n/provider";
import { getRequestMessages } from "@/lib/i18n/server";
import { DEFAULT_DESCRIPTION, OG_IMAGE_PATH, SITE_NAME, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getUsageSnapshot } from "@/lib/usage";
import "./globals.css";
import "./editor-v2.css";

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

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, messages } = await getRequestMessages();
  let initialUsageState: UsageState = { authenticated: false, usage: null };
  try {
    const authenticatedUser = await getAuthenticatedUser();
    if (authenticatedUser) {
      const db = getDb();
      const appUserRows = await db`
        select id
        from shorts_mvp.app_users
        where auth_user_id=${authenticatedUser.id}
        limit 1
      `;
      const appUserId = typeof appUserRows[0]?.id === "string" ? appUserRows[0].id : null;
      initialUsageState = {
        authenticated: true,
        usage: appUserId
          ? await getUsageSnapshot(db, {
              id: "",
              selectedPlanCode: "free",
              userId: appUserId,
              user: null,
            })
          : null,
      };
    }
  } catch (error) {
    console.error("header_initial_usage_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  const websiteData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        alternateName: ["EasyCut", "Easy Cut"],
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
          availableLanguage: ["Korean", "English", "Japanese"],
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: ["EasyCut", "Easy Cut"],
        description: DEFAULT_DESCRIPTION,
        inLanguage: locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "ja-JP",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <html lang={locale}>
      <body>
        <I18nProvider key={locale} locale={locale} messages={messages}>
          <StructuredData data={websiteData} />
          <UsageProvider initialState={initialUsageState}>
            {children}
            <EditorLaunchAnnouncementOverlay />
            <UserOnboardingOverlay />
            <ProjectFeedbackOverlay />
          </UsageProvider>
          <FirebaseAnalytics
            config={{
              apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
              authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
              projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
              storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
              messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
              appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
              measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
            }}
          />
          <LanguageSelector />
        </I18nProvider>
      </body>
    </html>
  );
}
