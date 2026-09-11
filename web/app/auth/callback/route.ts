import { NextRequest, NextResponse } from "next/server";
import { authFailureUrl, OAUTH_NEXT_COOKIE, requestAppOrigin, safeNextPath } from "@/lib/auth";
import { claimMvpSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const next = safeNextPath(
    request.cookies.get(OAUTH_NEXT_COOKIE)?.value
      || request.nextUrl.searchParams.get("next"),
  );
  const code = request.nextUrl.searchParams.get("code");
  try {
    if (code) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.user) {
        await claimMvpSession(data.user);
        const response = NextResponse.redirect(new URL(next, requestAppOrigin(request)), { status: 303 });
        response.cookies.set(OAUTH_NEXT_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
        return response;
      }
    }
  } catch {
    // Redirect to a user-facing error instead of exposing provider or DB details.
  }
  const target = authFailureUrl(request, next, "AUTH_CALLBACK_FAILED");
  const response = NextResponse.redirect(target, { status: 303 });
  response.cookies.set(OAUTH_NEXT_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
  return response;
}
