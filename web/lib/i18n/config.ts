export const siteLocales = ["ko", "en", "ja"] as const;

export type SiteLocale = (typeof siteLocales)[number];

export const DEFAULT_SITE_LOCALE: SiteLocale = "ko";
export const SITE_LOCALE_COOKIE = "easycut_locale";
export const SITE_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const localeTags: Record<SiteLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
};

export function isSiteLocale(value: unknown): value is SiteLocale {
  return typeof value === "string" && siteLocales.includes(value as SiteLocale);
}

export function normalizeSiteLocale(value: unknown): SiteLocale {
  return isSiteLocale(value) ? value : DEFAULT_SITE_LOCALE;
}

export function formatLocale(locale: SiteLocale) {
  return localeTags[locale];
}

export function localizedValue<T>(locale: SiteLocale, values: Record<SiteLocale, T>) {
  return values[locale];
}

export function nicepayLanguage(locale: SiteLocale): "KO" | "EN" {
  return locale === "ko" ? "KO" : "EN";
}
