import { type SiteLocale } from "./config";

export const SITE_LOCALE_HEADER = "x-easycut-site-locale";
const prefixes: Record<SiteLocale, string> = { ko: "", en: "/en", ja: "/jp" };
// Only page routes belong here. APIs, auth callbacks, admin and static files
// retain their original addresses, including future publishing endpoints.
const pageRoots = new Set([
  "ranking-shorts", "ai-shorts-maker", "popular", "templates", "support", "team", "compare",
  "easycut-private", "guidebook", "refund", "blog", "account", "pricing",
  "pricing-2", "terms", "settings", "faq", "enterprise", "purchase-terms",
  "privacy", "projects", "billing", "실시간인기", "shorts-monetization", "saved-videos", "updates",
]);

export function localePath(pathname: string) {
  const match = pathname.match(/^\/(en|jp)(?=\/|$)/);
  return {
    locale: (match?.[1] === "en" ? "en" : match?.[1] === "jp" ? "ja" : "ko") as SiteLocale,
    pathname: match ? pathname.slice(match[0].length) || "/" : pathname,
    prefixed: Boolean(match),
  };
}

export function isLocalizedPage(pathname: string) {
  if (pathname === "/") return true;
  if (/^\/[1-9]\d*(?:\/edit\/[^/]+)?\/?$/.test(pathname)) return true;
  return pageRoots.has(pathname.split("/")[1]);
}

export function localizedHref(href: string, locale: SiteLocale): string {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(href)) return href;
  const path = href.split(/[?#]/, 1)[0];
  // slice, rather than rebuilding URLSearchParams, preserves query/hash bytes.
  const tail = href.slice(path.length);
  const { pathname } = localePath(path);
  // Authentication stays on its shared endpoint; its destination is a page.
  if (path === "/auth/sign-in") {
    const url = new URL(href, "https://local.invalid");
    const next = url.searchParams.get("next") || "/";
    const nextPath = localePath(next.split(/[?#]/, 1)[0]).pathname;
    if (isLocalizedPage(nextPath)) {
      url.searchParams.set("next", localizedHref(next, locale));
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return href;
  }
  if (!isLocalizedPage(pathname)) return href;
  // Ranking currently ships in Korean and English; use English for Japanese navigation.
  if (pathname === "/ranking-shorts" && locale === "ja") return `/en/ranking-shorts${tail}`;
  return `${prefixes[locale]}${pathname === "/" ? (locale === "ko" ? "/" : "") : pathname}${tail}`;
}

export function browserLocalizedHref(href: string) {
  return localizedHref(href, typeof window === "undefined" ? "ko" : localePath(window.location.pathname).locale);
}

// Payment SDKs accept absolute return URLs. Keep their origin and every token;
// only our own page path receives a language prefix.
export function localizedReturnUrl(href: string, locale: SiteLocale, origin: string) {
  const url = new URL(href, origin);
  if (url.origin !== new URL(origin).origin) return href;
  url.pathname = localizedHref(url.pathname, locale);
  return url.toString();
}
