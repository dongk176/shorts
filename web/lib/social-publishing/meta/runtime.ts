import "server-only";
import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { requireMetaAdminPublishing } from "../access";
import { TikTokMedia } from "../tiktok/media";
import { metaConfig } from "./config";
import type { MetaPlatform } from "./contracts";
import { MetaStore } from "./store";
import { MetaVault } from "./vault";
import { MetaApi } from "./api";
import { MetaPublishing } from "./service";

export function metaServices(platform: MetaPlatform) {
  const config = metaConfig(platform), db = getDb();
  const store = new MetaStore(db, config.appKey);
  const vault = new MetaVault(Buffer.from(process.env.META_TOKEN_KEY || "", "base64"), config.appKey);
  const service = new MetaPublishing(store, vault, new MetaApi(config), new TikTokMedia(), config, id => requireMetaAdminPublishing(db, id));
  return { config, store, service };
}
export async function metaContext(platform: MetaPlatform) {
  metaConfig(platform);
  const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
  await requireMetaAdminPublishing(getDb(), session.userId);
  return { ...metaServices(platform), actor: { userId: session.userId, sessionId: session.id } };
}
