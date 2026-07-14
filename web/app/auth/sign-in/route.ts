import { NextRequest, NextResponse } from "next/server";
import { OAUTH_NEXT_COOKIE, requestAppOrigin, safeNextPath } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const provider = request.nextUrl.searchParams.get("provider") || "google";
    if (provider !== "google" && provider !== "kakao") throw new Error("지원하지 않는 로그인 방식입니다.");
    const callback = new URL("/auth/callback", requestAppOrigin(request));
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.toString(),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) throw error || new Error("로그인 주소를 만들지 못했습니다.");
    const response = NextResponse.redirect(data.url, { status: 302 });
    response.cookies.set(OAUTH_NEXT_COOKIE, next, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const target = new URL("/", requestAppOrigin(request));
    target.searchParams.set("auth_error", error instanceof Error ? error.message : "로그인을 시작하지 못했습니다.");
    return NextResponse.redirect(target, { status: 302 });
  }
}
