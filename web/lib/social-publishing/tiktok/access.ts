import "server-only";
import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";
import { getBillingSummary } from "@/lib/billing";
import { billingSupportsPaidProjectActions } from "@/lib/project-action-entitlements";
import { tiktokConfig, type TikTokConfig } from "./config";

export async function requireTikTokAccountAccess(db: Sql, userId: string, config: TikTokConfig) {
  if (!config.hosted) {
    if (!config.allowedUsers.has(userId)) throw new HttpError(403, "TikTok publishing is not available for this account.", "TIKTOK_DISABLED");
    return { isAdmin: false };
  }
  const rows = await db`select is_admin from shorts_mvp.app_users where id=${userId} and withdrawn_at is null limit 1`;
  if (!rows.length || !config.publicEnabled && !rows[0].isAdmin) throw new HttpError(403, "TikTok publishing is not available for this account.", "TIKTOK_DISABLED");
  return { isAdmin: Boolean(rows[0].isAdmin) };
}

export async function requireTikTokPublishingAccess(db: Sql, userId: string, config: TikTokConfig) {
  const { isAdmin } = await requireTikTokAccountAccess(db, userId, config);
  if (!isAdmin && !billingSupportsPaidProjectActions(await getBillingSummary(db, userId))) {
    throw new HttpError(402, "A paid plan is required to publish.", "TIKTOK_PAID_PLAN_REQUIRED");
  }
}

export async function canUseTikTokPublishing(db: Sql, userId: string) {
  let config: TikTokConfig;
  try { config = tiktokConfig(); } catch (error) { if (error instanceof HttpError) return false; throw error; }
  try { await requireTikTokAccountAccess(db, userId, config); return true; }
  catch (error) { if (error instanceof HttpError) return false; throw error; }
}
