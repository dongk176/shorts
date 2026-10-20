import { type SiteLocale, localeTags } from "./i18n/config";
import { localizedHref } from "./i18n/routing";
import { seoBrand, seoDescriptions } from "./seo-localization";
import { SITE_URL, absoluteUrl } from "./seo";
import { paddlePlan } from "./paddle/catalog";
import { tossPlan } from "./toss-subscription";

export function websiteStructuredData(locale: SiteLocale) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: locale === "ko" ? "이지컷" : "EasyCut",
        alternateName: ["이지컷", "Easy Cut", "イージーカット"], legalName: "아티룸", url: SITE_URL,
        logo: { "@type": "ImageObject", url: `${SITE_URL}/east-cut-logo.png` },
        contactPoint: { "@type": "ContactPoint", telephone: "+82-10-4836-2874", email: "easycut@easycut.co.kr", contactType: "customer support", availableLanguage: ["Korean", "English", "Japanese"] },
      },
      {
        "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: locale === "ko" ? "이지컷" : "EasyCut",
        alternateName: ["이지컷", "Easy Cut", "イージーカット"], description: seoDescriptions[locale],
        inLanguage: ["ko-KR", "en", "ja-JP"], publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

export function publicMonthlyOffer(locale: SiteLocale, internationalPricing: boolean) {
  // Match the anonymous pricing page; account-specific contracts are not public offers.
  if (locale !== "ko") {
    if (!internationalPricing) return undefined;
    const plan = paddlePlan(locale === "ja" ? "paddle_lite_jpy_20261021" : "paddle_lite");
    return {
      "@type": "Offer", name: "EasyCut Pro",
      description: locale === "ja" ? "月額プラン・毎月のお支払い" : "Monthly subscription, billed every month",
      price: locale === "ja" ? String(plan.jpy) : (plan.usd / 100).toFixed(2),
      priceCurrency: locale === "ja" ? "JPY" : "USD", url: absoluteUrl(localizedHref("/pricing", locale)),
    };
  }
  const plan = tossPlan("toss_easycut_pro_1m");
  return { "@type": "Offer", name: plan.displayName, description: "월간 구독 · 매월 결제", price: String(plan.priceKrw), priceCurrency: "KRW", url: absoluteUrl("/pricing") };
}

export function localizedBreadcrumb(locale: SiteLocale, path: string, name: string) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: { ko: "홈", en: "Home", ja: "ホーム" }[locale], item: absoluteUrl(localizedHref("/", locale)) },
      { "@type": "ListItem", position: 2, name, item: absoluteUrl(localizedHref(path, locale)) },
    ],
  };
}

export function localizedArticle(locale: SiteLocale, path: string, title: string, description: string, published: string, modified: string) {
  return {
    "@context": "https://schema.org", "@type": "Article", headline: title, description,
    image: absoluteUrl(locale === "ko" ? "/easy-cut-og-1200x630-v3.jpg" : locale === "en" ? "/easycut-og-en-v1.jpg" : "/easycut-og-ja-v1.jpg"),
    datePublished: published, dateModified: modified, inLanguage: localeTags[locale],
    mainEntityOfPage: absoluteUrl(localizedHref(path, locale)),
    author: { "@id": `${SITE_URL}/#organization` }, publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function applicationIdentity(locale: SiteLocale) {
  return { name: seoBrand[locale], alternateName: ["이지컷", "EasyCut", "Easy Cut", "イージーカット"], url: absoluteUrl(localizedHref("/", locale)), description: seoDescriptions[locale] };
}
