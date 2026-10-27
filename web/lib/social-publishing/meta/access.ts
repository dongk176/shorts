import "server-only";
import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";
import { getBillingSummary } from "@/lib/billing";
import { billingSupportsPaidProjectActions } from "@/lib/project-action-entitlements";
import { requireMetaAdminPublishing } from "../access";
import { metaConfig, type MetaConfig } from "./config";

export async function requireMetaAccountAccess(db: Sql, userId: string, config: MetaConfig) {
  if (!config.publicEnabled) return requireMetaAdminPublishing(db, userId);
  const rows = await db`select id from shorts_mvp.app_users where id=${userId} and withdrawn_at is null limit 1`;
  if (!rows.length) throw new HttpError(403, "Publishing is not available for this account.", "META_DISABLED");
}

export async function requireMetaPublishingAccess(db: Sql, userId: string, config: MetaConfig) {
  await requireMetaAccountAccess(db, userId, config);
  if (!config.publicEnabled) return;
  const rows = await db`select is_admin from shorts_mvp.app_users where id=${userId} and withdrawn_at is null limit 1`;
  if (!rows.length) throw new HttpError(403, "Publishing is not available for this account.", "META_DISABLED");
  if (!rows[0].isAdmin && !billingSupportsPaidProjectActions(await getBillingSummary(db, userId))) {
    throw new HttpError(402, "A paid plan is required to publish.", "META_PAID_PLAN_REQUIRED");
  }
}

export async function canUseInstagramPublishing(db: Sql, userId: string) {
  try {
    const config = metaConfig("instagram");
    if (!config.publicEnabled) return false;
    await requireMetaAccountAccess(db, userId, config);
    return true;
  } catch (error) {
    if (error instanceof HttpError) return false;
    throw error;
  }
}
