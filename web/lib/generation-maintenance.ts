import { NextRequest, NextResponse } from "next/server";
import { SITE_LOCALE_COOKIE } from "./i18n/config";
import { entryLocale } from "./i18n/entry-locale";
import { localePath } from "./i18n/routing";

import { generationMaintenanceCopy, CONVERSION_MAINTENANCE_START_MS, CONVERSION_MAINTENANCE_END_MS } from "./conversion-maintenance";
export const GENERATION_MAINTENANCE_START = CONVERSION_MAINTENANCE_START_MS;
export const GENERATION_MAINTENANCE_END = CONVERSION_MAINTENANCE_END_MS;


export function generationMaintenanceResponse(request: NextRequest, now = Date.now()): NextResponse | null {
  if (now < GENERATION_MAINTENANCE_START || now >= GENERATION_MAINTENANCE_END) return null;
  const route = localePath(request.nextUrl.pathname);
  const path = route.pathname.replace(/\/$/, "") || "/";
  const api = request.method === "POST" && (
    path === "/api/jobs" || path === "/api/youtube/analyze" || path === "/api/file-upload/sessions"
    || path === "/api/ranking-shorts" || path === "/api/ranking-shorts/discover"
    || /^\/api\/ranking-shorts\/[^/]+\/(render|sources|session)$/.test(path)
    || /^\/api\/ranking-shorts\/[^/]+\/sources\/[^/]+\/preview$/.test(path)
  );
  if (!api) return null;
  let locale = route.prefixed ? route.locale : entryLocale(
    request.cookies.get(SITE_LOCALE_COOKIE)?.value,
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("accept-language"),
  );
  if (api) {
    try {
      const referer = new URL(request.headers.get("referer") || "");
      if (referer.origin === request.nextUrl.origin) locale = localePath(referer.pathname).locale;
    } catch { /* Requests without a page use their language preference. */ }
  }
  const copy = generationMaintenanceCopy[locale];
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Retry-After": String(Math.max(1, Math.ceil((GENERATION_MAINTENANCE_END - now) / 1000))),
    "Content-Language": locale,
    Vary: "Cookie, Accept-Language, X-Vercel-IP-Country",
  };
  return NextResponse.json({ detail: copy.detail, code: "GENERATION_MAINTENANCE", endsAt: "2026-11-25T05:00:00Z" }, { status: 503, headers });
}
