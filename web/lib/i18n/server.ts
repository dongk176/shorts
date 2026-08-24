import "server-only";

import { cookies } from "next/headers";
import { normalizeSiteLocale, SITE_LOCALE_COOKIE } from "./config";
import { messagesByLocale } from "./messages";

export async function getRequestLocale() {
  const cookieStore = await cookies();
  return normalizeSiteLocale(cookieStore.get(SITE_LOCALE_COOKIE)?.value);
}

export async function getRequestMessages() {
  const locale = await getRequestLocale();
  return { locale, messages: messagesByLocale[locale] };
}
