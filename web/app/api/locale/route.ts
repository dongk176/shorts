import { NextResponse } from "next/server";
import {
  isSiteLocale,
  SITE_LOCALE_COOKIE,
  SITE_LOCALE_COOKIE_MAX_AGE,
} from "@/lib/i18n/config";

export async function POST(request: Request) {
  const value = await request.json().catch(() => null) as { locale?: unknown } | null;
  if (!isSiteLocale(value?.locale)) {
    return NextResponse.json(
      { detail: "지원하지 않는 언어입니다.", code: "INVALID_LOCALE" },
      { status: 400 },
    );
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SITE_LOCALE_COOKIE, value.locale, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_LOCALE_COOKIE_MAX_AGE,
  });
  return response;
}
