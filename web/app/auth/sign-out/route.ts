import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";
import { MVP_SESSION_COOKIE } from "@/lib/session";
import { createSupabaseServerClient, getSupabaseAuthConfig } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (getSupabaseAuthConfig()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  const cookieStore = await cookies();
  cookieStore.delete(MVP_SESSION_COOKIE);
  const form = await request.formData().catch(() => null);
  const next = safeNextPath(typeof form?.get("next") === "string" ? String(form.get("next")) : "/");
  return NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 303 });
}
