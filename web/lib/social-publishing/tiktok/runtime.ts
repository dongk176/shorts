import "server-only";
import { getDb } from "@/lib/db";
import { requireAdminPublishing } from "../access";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { HttpError } from "@/lib/http";
import { tiktokConfig } from "./config";
import { TikTokApi } from "./api";
import { TikTokStore } from "./store";
import { TikTokVault } from "./vault";
import { TikTokMedia } from "./media";
import { TikTokPublishing } from "./service";

export async function tiktokServices() {
  const config = tiktokConfig(), db = getDb();
  if (config.hosted) {
    const rows = await db`select verified_at from shorts_mvp.tiktok_review_settings where origin=${config.publicOrigin}`;
    // Keep publishing disabled until TikTok confirms the production origin.
    config.mediaVerified = config.mediaVerified && Boolean(rows[0]?.verifiedAt);
  }
  const vault = new TikTokVault(Buffer.from(process.env.TIKTOK_TOKEN_KEY || "", "base64"), config.clientKey);
  const store = new TikTokStore(db, config.clientKey);
  const media = new TikTokMedia();
  const service = new TikTokPublishing(store, vault, new TikTokApi(config), media, config, async userId => {
    await requireAdminPublishing(db, userId);
  });
  return { config, store, service };
}
export async function tiktokContext() {
  const config = tiktokConfig();
  const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
  if (config.hosted) await requireAdminPublishing(getDb(), session.userId);
  else if (!config.allowedUsers.has(session.userId)) throw new HttpError(403, "TikTok publishing is not available for this account.", "TIKTOK_DISABLED");
  return { ...await tiktokServices(), actor: { userId: session.userId, sessionId: session.id } };
}
