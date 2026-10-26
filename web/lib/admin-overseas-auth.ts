import "server-only";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/admin";

export async function requireOverseasAdminUser(): Promise<AdminUser> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) throw new HttpError(401, "로그인이 필요합니다.");
  // Re-check the server-owned role on each request; editable JWT metadata and
  // the existing full-admin flag cannot grant this role.
  const [user] = await getDb()`
    select u.id,u.auth_user_id,u.email,u.display_name
    from shorts_mvp.app_users u
    join shorts_mvp.admin_role_assignments r on r.user_id=u.id
      and r.role='overseas_admin'
    where u.auth_user_id=${authUser.id} and u.withdrawn_at is null
    limit 1
  `;
  if (!user) throw new HttpError(403, "해외 전용 관리자 권한이 필요합니다.");
  return {
    id: user.id, authUserId: user.authUserId,
    email: String(user.email || authUser.email || ""),
    displayName: user.displayName || null,
  };
}
