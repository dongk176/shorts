import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  authUserId: string;
  email: string;
  displayName: string | null;
};

export function isAdminAuthenticationRequired(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && error.status === 401;
}

export async function requireAdminUser(): Promise<AdminUser> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) throw new HttpError(401, "로그인이 필요합니다.");
  const rows = await getDb()`
    select id,auth_user_id,email,display_name
    from shorts_mvp.app_users
    where auth_user_id=${authUser.id} and is_admin=true
    limit 1
  `;
  const admin = rows[0];
  if (!admin) throw new HttpError(403, "관리자 권한이 필요합니다.");
  return {
    id: admin.id,
    authUserId: admin.authUserId,
    email: String(admin.email || authUser.email || ""),
    displayName: admin.displayName || null,
  };
}
