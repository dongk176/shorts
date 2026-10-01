import { type NextRequest, NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

import { isLocalizedPage, localePath, localizedHref, SITE_LOCALE_HEADER } from "@/lib/i18n/routing";
import { SITE_LOCALE_COOKIE } from "@/lib/i18n/config";
import { entryLocale, isLocaleCrawler } from "@/lib/i18n/entry-locale";

const CANONICAL_HOST = "www.easycut.co.kr";
const LEGACY_PRODUCTION_HOSTS = new Set([
  "easycut.co.kr",
  "shorts-weld-iota.vercel.app",
  "shorts-artiroom.vercel.app",
  "shorts-dmsthaalcls-1044-artiroom.vercel.app",
]);
const ADMIN_DASHBOARD_PATH = "/admin/easycutcutcutcutcutcut";
const DATABASE_HEAVY_NAVIGATION_PATHS = [
  /^\/projects\/[1-9]\d*(?:\/edit\/[^/]+)?\/?$/,
  /^\/templates\/new\/?$/,
  /^\/templates\/[^/]+\/edit\/?$/,
];

// Only known public assets bypass session refresh; dotted application routes do not.
const PUBLIC_ASSETS = new Set([
  "/easycut-og-ja-v1.jpg",
  "/easycut-og-en-v1.jpg",
  "/thepayone-mark.png",
  "/creator-support-og-20260912.png",
  "/east-cut-logo.png",
  "/easy-cut-og-1200x630-v3.jpg",
  "/easycut-partner-1-og.png",
  "/easy-cut-og-1200x630-v2.png",
  "/updates/saved-empty.jpg",
  "/updates/templates.jpg",
  "/updates/pricing.jpg",
  "/updates/guide.jpg",
  "/updates/subtitles.jpg",
  "/updates/community.jpg",
  "/updates/showcase.jpg",
  "/updates/channels.jpg",
  "/updates/creation.jpg",
  "/updates/background.jpg",
  "/updates/search.jpg",
  "/updates/project.jpg",
  "/updates/upload.jpg",
  "/updates/blog.jpg",
  "/updates/language.jpg",
  "/updates/sns.jpg",
  "/updates/period.jpg",
  "/updates/template-editor.jpg",
  "/updates/navigation.jpg",
  "/updates/popular.jpg",
  "/updates/youtube-launch/privacy-detail.png",
  "/updates/youtube-launch/title-description.png",
  "/updates/youtube-launch/connect-focused.png",
  "/updates/youtube-launch/project-actions.png"
]);
const PUBLIC_ASSET_DIRECTORY = /^\/(?:fonts\/editor\/[^/]+\.(?:ttf|otf|woff2?)|template-backgrounds\/[^/]+\.(?:png|jpg|webp)|guidebook\/pages\/page-\d+\.jpg)$/;

function isNavigationPrefetch(request: NextRequest) {
  return request.headers.get("next-router-prefetch") === "1"
    || request.headers.get("purpose")?.toLowerCase() === "prefetch"
    || request.headers.get("sec-purpose")?.toLowerCase().includes("prefetch") === true;
}

function isDatabaseHeavyNavigation(pathname: string) {
  return pathname.startsWith(ADMIN_DASHBOARD_PATH)
    || DATABASE_HEAVY_NAVIGATION_PATHS.some((pattern) => pattern.test(pathname));
}

export async function middleware(request: NextRequest) {
  if (LEGACY_PRODUCTION_HOSTS.has(request.nextUrl.hostname)) {
    const destination = request.nextUrl.clone();
    destination.protocol = "https:";
    destination.host = CANONICAL_HOST;
    return NextResponse.redirect(destination, 308);
  }

  let pathname = request.nextUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return refreshSupabaseSession(request);
  }
  const route = localePath(pathname);
  const homeEntry = pathname === "/" && !route.prefixed && ["GET", "HEAD"].includes(request.method);
  if (homeEntry && !isLocaleCrawler(request.headers.get("user-agent"))) {
    const locale = entryLocale(
      request.cookies.get(SITE_LOCALE_COOKIE)?.value,
      request.headers.get("x-vercel-ip-country"),
      request.headers.get("accept-language"),
    );
    if (locale !== "ko") {
      const destination = request.nextUrl.clone();
      destination.pathname = localizedHref("/", locale);
      const response = NextResponse.redirect(destination, 307);
      preventSharedLocaleCache(response);
      return response;
    }
  }
  if (route.prefixed && !isLocalizedPage(route.pathname)) {
    return new NextResponse(null, { status: 404 });
  }
  if (!route.prefixed && ["GET", "HEAD"].includes(request.method)
    && (PUBLIC_ASSETS.has(pathname) || PUBLIC_ASSET_DIRECTORY.test(pathname))) {
    return NextResponse.next();
  }
  pathname = route.pathname;
  // Always overwrite a supplied header; the page URL decides its language.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SITE_LOCALE_HEADER, route.locale);
  if (pathname === "/실시간인기") {
    const destination = request.nextUrl.clone();
    destination.pathname = localizedHref("/popular", route.locale);
    return NextResponse.redirect(destination, 308);
  }

  const legacyProjectPath = pathname.match(/^\/([1-9]\d*)(\/edit\/[^/]+)?\/?$/);
  if (legacyProjectPath) {
    const destination = request.nextUrl.clone();
    destination.pathname = localizedHref(`/projects/${legacyProjectPath[1]}${legacyProjectPath[2] || ""}`, route.locale);
    return NextResponse.redirect(destination, 308);
  }

  if (pathname === "/auth/sign-out") {
    return NextResponse.next({ request });
  }

  // Older client bundles can eagerly prefetch many database-backed RSC pages at
  // once. That fan-out can fill the small serverless database pool before the
  // user's real navigation is served. New links opt out too, while this breaker
  // protects already-open tabs until they receive the new bundle.
  if (
    request.method === "GET"
    && isDatabaseHeavyNavigation(pathname)
    && isNavigationPrefetch(request)
  ) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Next-Router-Prefetch, Purpose, Sec-Purpose",
      },
    });
  }

  // These pages must use the URL locale during server rendering. Concrete aliases
  // avoid a second middleware pass on shared routes resetting them to Korean.
  if (route.prefixed && ["/pricing", "/settings/plan", "/billing/paddle", "/shorts-monetization", "/saved-videos"].includes(pathname)) {
    return refreshSupabaseSession(request, undefined, requestHeaders);
  }
  const destination = request.nextUrl.clone();
  destination.pathname = pathname;
  const response = await refreshSupabaseSession(request, route.prefixed ? destination : undefined, requestHeaders);
  if (homeEntry) preventSharedLocaleCache(response);
  return response;
}

function preventSharedLocaleCache(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const vary = new Set((response.headers.get("Vary") || "").split(",").map((value) => value.trim()).filter(Boolean));
  for (const name of ["Cookie", "X-Vercel-IP-Country", "Accept-Language", "User-Agent"]) vary.add(name);
  response.headers.set("Vary", [...vary].join(", "));
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
