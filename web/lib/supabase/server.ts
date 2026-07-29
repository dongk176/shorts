import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getSupabaseAuthConfig } from "@/lib/supabase/config";

export { getSupabaseAuthConfig } from "@/lib/supabase/config";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type SupabaseAuthConfig = NonNullable<ReturnType<typeof getSupabaseAuthConfig>>;

function createConfiguredSupabaseServerClient(config: SupabaseAuthConfig, cookieStore: CookieStore) {
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          // Server Components receive a read-only cookie store. Supabase may
          // still attempt a refresh while getUser() is reading the session;
          // Route Handlers keep using the writable path above.
          const message = error instanceof Error
            ? error.message
            : typeof error === "object" && error && "message" in error
              ? String(error.message)
              : String(error);
          if (message.includes("Cookies can only be modified")) return;
          throw error;
        }
      },
    },
  });
}

export async function createSupabaseServerClient() {
  const config = getSupabaseAuthConfig();
  if (!config) {
    throw new Error("Supabase Auth URL과 publishable key가 설정되지 않았습니다.");
  }
  const cookieStore = await cookies();
  return createConfiguredSupabaseServerClient(config, cookieStore);
}

export async function getAuthenticatedUser() {
  // Read request cookies before checking optional configuration. In builds
  // where auth variables are injected only at runtime, returning first would
  // let Next.js prerender and publicly cache the signed-out header.
  const cookieStore = await cookies();
  const config = getSupabaseAuthConfig();
  if (!config) return null;
  const supabase = createConfiguredSupabaseServerClient(config, cookieStore);
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    const user = data.user;
    if (user?.app_metadata?.login_type === "managed") {
      const rows = await getDb()`
        select 1
        from shorts_mvp.managed_login_accounts
        where auth_user_id=${user.id} and is_active=true
        limit 1
      `;
      if (!rows[0]) return null;
    }
    return user;
  } catch {
    return null;
  }
}
