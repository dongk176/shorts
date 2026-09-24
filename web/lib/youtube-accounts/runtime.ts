import "server-only";
import path from "node:path";
import { reviewConfig, assertHostedYoutubeAccess } from "./review-access";
import { HostedYoutubeSources } from "./hosted-sources";
import { YoutubeAccountUploads } from "./uploads";
import { getDb } from "@/lib/db";
import { getBillingSummary } from "@/lib/billing";
import { HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { TokenVault } from "./crypto";
import { YoutubeAccountGoogle } from "./google";
import { YoutubeAccountStore } from "./store";
import { YoutubeAccounts } from "./service";
import { YoutubeRetention } from "./retention";
import { uuid } from "./contracts";

export function accountConfig() {
  if (process.env.YOUTUBE_ACCOUNTS_MODE === "review") return reviewConfig();
  if (process.env.YOUTUBE_ACCOUNTS_MODE !== "local" || process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) throw new HttpError(404, "YouTube 채널 연결 기능이 아직 활성화되지 않았습니다.");
  const origin = process.env.YOUTUBE_ACCOUNTS_ORIGIN;
  if (origin !== "http://localhost:3001") throw new HttpError(503, "YouTube 연결 주소 설정을 확인해 주세요.");
  const database = new URL(process.env.DATABASE_URL || "http://invalid");
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) throw new HttpError(503, "이 후보는 로컬 데이터베이스에서만 사용할 수 있습니다.");
  const allowedUsers = new Set((process.env.YOUTUBE_ACCOUNTS_ALLOWED_USER_IDS || "").split(",").filter(Boolean));
  if (!allowedUsers.size || [...allowedUsers].some(id => !uuid.safeParse(id).success)) throw new HttpError(503, "검증 사용자 설정이 필요합니다.");
  const clientId = process.env.YOUTUBE_ACCOUNTS_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_ACCOUNTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError(503, "YouTube 연결 설정이 필요합니다.");
  const allowNonPrivateUploads = process.env.YOUTUBE_ACCOUNTS_ALLOW_NON_PRIVATE_UPLOADS === "true";
  return { hosted: false as const, origin, allowedUsers, clientId, clientSecret, allowNonPrivateUploads, redirectUri: "http://localhost:3000/api/youtube/oauth/callback" };
}
export function accountServices() {
  const config = accountConfig();
  const keyring = JSON.parse(process.env.YOUTUBE_ACCOUNTS_KEYRING || "{}");
  const keys = Object.fromEntries(Object.entries(keyring).map(([key, value]) => [key, Buffer.from(String(value), "base64")]));
  const vault = new TokenVault(keys, process.env.YOUTUBE_ACCOUNTS_ACTIVE_KEY || "");
  const store = new YoutubeAccountStore(getDb(), config.hosted ? (userId, shortId, db) => assertHostedYoutubeAccess(db, userId, shortId) : undefined);
  const google = new YoutubeAccountGoogle(config);
  const service = new YoutubeAccounts(store, vault, google, async userId => {
    if (config.hosted) { await assertHostedYoutubeAccess(getDb(), userId); return; }
    // Publishing must retain the same paid entitlement as downloading this output.
    assertPaidProjectActionAccess(await getBillingSummary(getDb(), userId), "download");
  });
  const uploads = new YoutubeAccountUploads(getDb(), store, service, vault, config, path.join(process.cwd(), "storage/youtube-account-sources"), fetch, config.hosted ? new HostedYoutubeSources() : undefined);
  const retention = new YoutubeRetention(getDb(), store, service, vault, google);
  return { config, store, service, uploads, retention };
}
export async function accountContext(allowExpired = false) {
  const config = accountConfig();
  const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
  if (!config.hosted && !config.allowedUsers.has(session.userId)) throw new HttpError(403, "아직 이 계정에서 사용할 수 없는 기능입니다.");
  if (config.hosted) await assertHostedYoutubeAccess(getDb(), session.userId, undefined, allowExpired);
  const { service, uploads } = accountServices();
  return { service, uploads, actor: { userId: session.userId, sessionId: session.id }, origin: config.origin };
}
