import "server-only";
import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";

// The rollout grants publishing, never site administration, to the client UI.
// Every API independently rechecks this server-side role from the database.
export async function canUseAdminPublishing(db: Sql, userId: string) {
  if (process.env.TIKTOK_PUBLISHING_MODE !== "admin-review") return false;
  const rows = await db`select id from shorts_mvp.app_users where id=${userId} and is_admin=true and withdrawn_at is null limit 1`;
  return rows.length === 1;
}

export async function requireAdminPublishing(db: Sql, userId: string) {
  if (!await canUseAdminPublishing(db, userId)) throw new HttpError(403, "Publishing is not available for this account.", "TIKTOK_DISABLED");
}
