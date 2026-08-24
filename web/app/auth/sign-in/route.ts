import { NextRequest, NextResponse } from "next/server";
import { OAUTH_NEXT_COOKIE, requestAppOrigin, safeNextPath } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const provider = request.nextUrl.searchParams.get("provider");
    if (!provider) {
      const target = new URL("/", requestAppOrigin(request));
      target.searchParams.set("login", "1");
      target.searchParams.set("next", next);
      return NextResponse.redirect(target, { status: 303 });
    }
    if (provider !== "google" && provider !== "kakao") throw new Error("AUTH_UNSUPPORTED_PROVIDER");
    const callback = new URL("/auth/callback", requestAppOrigin(request));
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.toString(),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) throw error || new Error("AUTH_START_FAILED");
    const response = NextResponse.redirect(data.url, { status: 302 });
    response.cookies.set(OAUTH_NEXT_COOKIE, next, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    const target = new URL("/", requestAppOrigin(request));
    target.searchParams.set("auth_error", "AUTH_START_FAILED");
    return NextResponse.redirect(target, { status: 302 });
  }
}
