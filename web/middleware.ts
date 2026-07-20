import { type NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "www.easycut.co.kr";
const LEGACY_PRODUCTION_HOSTS = new Set([
  "easycut.co.kr",
  "shorts-weld-iota.vercel.app",
  "shorts-artiroom.vercel.app",
  "shorts-dmsthaalcls-1044-artiroom.vercel.app",
]);

export function middleware(request: NextRequest) {
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
    return NextResponse.next();
  }
  if (pathname === "/실시간인기") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/popular";
    return NextResponse.redirect(destination, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
