import { requireAdminUser, type AdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

export async function hasExpenseAccess(admin: AdminUser): Promise<boolean> {
  try {
    const rows = await getDb()`select user_id from shorts_mvp.admin_expense_access where user_id=${admin.id} limit 1`;
    return rows.length === 1;
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return false;
    throw error;
  }
}
export async function requireExpenseAdmin() {
  const admin = await requireAdminUser();
  if (!await hasExpenseAccess(admin)) throw new HttpError(403, "매입·비용 관리 권한이 필요합니다.");
  return admin;
}
