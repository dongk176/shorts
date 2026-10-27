import "server-only";
import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { requireMetaAccountAccess, requireMetaPublishingAccess } from "./access";
import { TikTokMedia } from "../tiktok/media";
import { metaConfig } from "./config";
import type { MetaPlatform } from "./contracts";
import { MetaStore } from "./store";
import { MetaVault } from "./vault";
import { MetaApi } from "./api";
import { MetaPublishing } from "./service";

export function metaServices(platform: MetaPlatform) {
  const config = metaConfig(platform), db = getDb();
  const store = new MetaStore(db, config.appKey, config.publicEnabled);
  const vault = new MetaVault(Buffer.from(process.env.META_TOKEN_KEY || "", "base64"), config.appKey);
  const service = new MetaPublishing(store, vault, new MetaApi(config), new TikTokMedia(), config, id => requireMetaAccountAccess(db, id, config), id => requireMetaPublishingAccess(db, id, config));
  return { config, store, service };
}
export async function metaContext(platform: MetaPlatform) {
  const config = metaConfig(platform);
  const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
  await requireMetaAccountAccess(getDb(), session.userId, config);
  return { ...metaServices(platform), actor: { userId: session.userId, sessionId: session.id } };
}
