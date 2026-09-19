import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "@/lib/supabase/config";
import {
  fetchSupabaseAuth,
  withSupabaseAuthTimeout,
} from "@/lib/supabase/auth-fetch";

export async function refreshSupabaseSession(request: NextRequest, rewriteUrl?: URL, requestHeaders = new Headers(request.headers)) {
  const nextResponse = () => rewriteUrl
    ? NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  let response = nextResponse();
  const config = getSupabaseAuthConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    global: { fetch: fetchSupabaseAuth },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        requestHeaders.set("cookie", request.headers.get("cookie") || "");
        response = nextResponse();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  try {
    await withSupabaseAuthTimeout(supabase.auth.getClaims());
  } catch (error) {
    console.warn("supabase_session_refresh_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  return response;
}
