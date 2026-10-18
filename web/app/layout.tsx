import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { ApplicationOverlays } from "@/components/application-overlays";
import { EditorLaunchAnnouncementOverlay } from "@/components/editor-launch-announcement-overlay";
import { GoogleAnalyticsMeasurement } from "@/components/google-analytics";
import { StructuredData } from "@/components/structured-data";
import { LanguageSelector } from "@/components/language-selector";
import { MarketingEmailPreferenceOverlay } from "@/components/marketing-email-preference-overlay";
import { ProjectFeedbackOverlay } from "@/components/project-feedback-overlay";
import { PaymentMethodRemediationGate } from "@/components/payment-method-remediation-gate";
import { SidebarNavigationAnnouncement } from "@/components/sidebar-navigation-announcement";
import { UserOnboardingOverlay } from "@/components/user-onboarding-overlay";
import { YoutubeLaunchAnnouncement } from "@/components/youtube-launch-announcement";
import { WelcomeOverlayQueueProvider } from "@/components/welcome-overlay-queue";
import { UsageProvider, type UsageState } from "@/components/usage-provider";
import { I18nProvider } from "@/lib/i18n/provider";
import { getRequestLocale, getRequestMessages } from "@/lib/i18n/server";
import { DEFAULT_DESCRIPTION, OG_IMAGE_PATH, SITE_NAME, SITE_URL, createPageMetadata } from "@/lib/seo";
import { seoBrand, seoDescriptions, seoCopyForPath } from "@/lib/seo-localization";
import { websiteStructuredData } from "@/lib/seo-structured-data";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { RecentUpdatesProvider } from "@/components/recent-updates-provider";
import "./globals.css";
import "./site-sidebar.css";
import "./editor-v2.css";
import "./editor-studio.css";
import "./payment-checkout.css";

const baseMetadata: Metadata = {
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = seoCopyForPath("/", locale);
  const localized = createPageMetadata({ title: copy?.title ?? "이지컷 | AI 쇼츠 자동 제작·유튜브 영상 편집", description: seoDescriptions[locale], path: "/", locale });
  return {
    ...baseMetadata, ...localized, alternates: undefined,
    applicationName: seoBrand[locale],
    title: { default: copy?.title ?? "이지컷 | AI 쇼츠 자동 제작·유튜브 영상 편집", template: `%s | ${locale === "ko" ? SITE_NAME : "EasyCut"}` },
    authors: [{ name: seoBrand[locale], url: SITE_URL }],
    creator: locale === "ko" ? "아티룸" : "Artiroom", publisher: locale === "ko" ? "아티룸" : "Artiroom",
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, messages } = await getRequestMessages();
  const analyticsMeasurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;
  const analyticsEnabled = (
    typeof analyticsMeasurementId === "string"
    && /^G-[A-Z0-9]+$/.test(analyticsMeasurementId)
  );
  const initialUsageState: UsageState = {
    authenticated: false,
    accountId: null,
    isEnterprise: false,
    usage: null,
  };
  const authenticatedUser = await getAuthenticatedUser();
  initialUsageState.authenticated = Boolean(authenticatedUser);
  const websiteData = websiteStructuredData(locale);

  return (
    <html lang={locale}>
      {analyticsEnabled ? (
        <Script id="easycut-google-analytics-consent" strategy="beforeInteractive">
          {`window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};window.gtag("consent","default",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});window.gtag("set","ads_data_redaction",true);`}
        </Script>
      ) : null}
      <body>
        <I18nProvider locale={locale} messages={messages}>
          <StructuredData data={websiteData} />
          <UsageProvider
            key={initialUsageState.accountId || "guest"}
            initialState={initialUsageState}
          >
            <WelcomeOverlayQueueProvider>
              <RecentUpdatesProvider>
                {children}
              </RecentUpdatesProvider>
              <ApplicationOverlays>
                <YoutubeLaunchAnnouncement />
                <UserOnboardingOverlay />
                <EditorLaunchAnnouncementOverlay />
                <SidebarNavigationAnnouncement />
                <MarketingEmailPreferenceOverlay />
                <ProjectFeedbackOverlay />
                <PaymentMethodRemediationGate
                  initialAction={null}
                  authenticated={initialUsageState.authenticated}
                />
              </ApplicationOverlays>
            </WelcomeOverlayQueueProvider>
          </UsageProvider>
          <GoogleAnalyticsMeasurement measurementId={analyticsMeasurementId} />
          <LanguageSelector />
        </I18nProvider>
      </body>
    </html>
  );
}
