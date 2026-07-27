import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";
import { MVP_SESSION_COOKIE } from "@/lib/session";
import { createSupabaseServerClient, getSupabaseAuthConfig } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authConfig = getSupabaseAuthConfig();
  let supabaseCookiePrefix: string | null = null;
  try {
    if (authConfig) {
      supabaseCookiePrefix = `sb-${new URL(authConfig.url).hostname.split(".")[0]}-auth-token`;
    }
  } catch {
    // Invalid optional auth configuration must not prevent local logout.
  }
  const supabaseCookieNames = supabaseCookiePrefix
    ? cookieStore.getAll()
      .map(({ name }) => name)
      .filter((name) =>
        name === supabaseCookiePrefix
        || name.startsWith(`${supabaseCookiePrefix}.`)
        || name === `${supabaseCookiePrefix}-code-verifier`
      )
    : [];
  try {
    if (authConfig) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch (error) {
    console.warn("supabase_local_sign_out_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    cookieStore.delete(MVP_SESSION_COOKIE);
    for (const name of supabaseCookieNames) cookieStore.delete(name);
  }
  const form = await request.formData().catch(() => null);
  const next = safeNextPath(typeof form?.get("next") === "string" ? String(form.get("next")) : "/");
  return NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 303 });
}
