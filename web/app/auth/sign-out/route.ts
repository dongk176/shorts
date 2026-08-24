import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { MVP_SESSION_COOKIE } from "@/lib/session";
import { createSupabaseServerClient, getSupabaseAuthConfig } from "@/lib/supabase/server";

const CANONICAL_AUTH_COOKIE_DOMAINS = ["www.easycut.co.kr", ".easycut.co.kr"] as const;
const CLIENT_NAVIGATION_HEADER = "x-easycut-client-navigation";
const EXPIRED_COOKIE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

function isCookieChunk(name: string, key: string) {
  if (name === key) return true;
  if (!name.startsWith(`${key}.`)) return false;
  return /^\d+$/.test(name.slice(key.length + 1));
}

function isSupabaseAuthCookie(name: string, storageKey: string) {
  return isCookieChunk(name, storageKey)
    || isCookieChunk(name, `${storageKey}-code-verifier`)
    || isCookieChunk(name, `${storageKey}-user`);
}

function appendExpiredCookie(
  response: NextResponse,
  name: string,
  secure: boolean,
  domain?: string,
) {
  const attributes = [
    `${name}=`,
    "Path=/",
    `Expires=${EXPIRED_COOKIE_DATE}`,
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (domain) attributes.push(`Domain=${domain}`);
  if (secure) attributes.push("Secure");
  response.headers.append("Set-Cookie", attributes.join("; "));
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authConfig = getSupabaseAuthConfig();
  let supabaseStorageKey: string | null = null;
  try {
    if (authConfig) {
      supabaseStorageKey = `sb-${new URL(authConfig.url).hostname.split(".")[0]}-auth-token`;
    }
  } catch {
    // Invalid optional auth configuration must not prevent local logout.
  }
  const supabaseCookieNames = supabaseStorageKey
    ? cookieStore.getAll()
      .map(({ name }) => name)
      .filter((name) => isSupabaseAuthCookie(name, supabaseStorageKey))
    : [];
  try {
    if (authConfig) {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.warn("supabase_local_sign_out_failed", {
          errorName: error.name || "AuthError",
        });
      }
    }
  } catch (error) {
    console.warn("supabase_local_sign_out_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  const response = request.headers.get(CLIENT_NAVIGATION_HEADER) === "1"
    ? new NextResponse(null, { status: 204 })
    : NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");

  const secure = request.nextUrl.protocol === "https:";
  const cookieNames = [...new Set([MVP_SESSION_COOKIE, ...supabaseCookieNames])];
  const domains = request.nextUrl.hostname === "www.easycut.co.kr"
    || request.nextUrl.hostname === "easycut.co.kr"
    ? CANONICAL_AUTH_COOKIE_DOMAINS
    : [];
  for (const name of cookieNames) {
    appendExpiredCookie(response, name, secure);
    for (const domain of domains) appendExpiredCookie(response, name, secure, domain);
  }
  return response;
}
