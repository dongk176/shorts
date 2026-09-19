import "server-only";

import { cookies, headers } from "next/headers";
import { normalizeSiteLocale, SITE_LOCALE_COOKIE } from "./config";
import { localizedHref, SITE_LOCALE_HEADER } from "./routing";
import { messagesByLocale } from "./messages";

export async function getRequestLocale() {
  const requestHeaders = await headers();
  const routeLocale = requestHeaders.get(SITE_LOCALE_HEADER);
  if (routeLocale) return normalizeSiteLocale(routeLocale);
  const cookieStore = await cookies();
  return normalizeSiteLocale(cookieStore.get(SITE_LOCALE_COOKIE)?.value);
}

export async function getRequestMessages() {
  const locale = await getRequestLocale();
  return { locale, messages: messagesByLocale[locale] };
}

export async function localizedRedirectPath(href: string) {
  const locale = await getRequestLocale();
  if (href.startsWith("/auth/sign-in?")) {
    const url = new URL(href, "https://local.invalid");
    url.searchParams.set("next", localizedHref(url.searchParams.get("next") || "/", locale));
    return `${url.pathname}${url.search}`;
  }
  return localizedHref(href, locale);
}
