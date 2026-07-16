import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  let pathname = request.nextUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return NextResponse.next();
  }
  if (pathname !== "/실시간인기") return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.pathname = "/popular";
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
