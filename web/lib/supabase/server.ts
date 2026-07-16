import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function getSupabaseAuthConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function createSupabaseServerClient() {
  const config = getSupabaseAuthConfig();
  if (!config) {
    throw new Error("Supabase Auth URL과 publishable key가 설정되지 않았습니다.");
  }
  const cookieStore = await cookies();
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
          if (error instanceof Error && error.message.includes("Cookies can only be modified")) return;
          throw error;
        }
      },
    },
  });
}

export async function getAuthenticatedUser() {
  if (!getSupabaseAuthConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
