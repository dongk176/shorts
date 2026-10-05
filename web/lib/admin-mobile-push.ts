import "server-only";
import { createHash } from "node:crypto";
import webPush from "web-push";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { allowedPushEndpoint, defaultMobilePreferences, pushConfigured, type MobilePreferences, type MobileSubscription } from "@/lib/admin-mobile-contract";

export function endpointHash(endpoint: string) { return createHash("sha256").update(endpoint).digest("hex"); }
export async function mobilePreferences(adminId: string): Promise<MobilePreferences> {
  const [row] = await getDb()`select payments,operations,quiet_night,show_amount
    from shorts_mvp.admin_mobile_preferences where admin_id=${adminId}`;
  return row ? { payments: row.payments, operations: row.operations, quietNight: row.quietNight, showAmount: row.showAmount } : { ...defaultMobilePreferences };
}
export async function saveMobilePreferences(adminId: string, p: MobilePreferences) {
  await getDb()`insert into shorts_mvp.admin_mobile_preferences(admin_id,payments,operations,quiet_night,show_amount)
    values(${adminId},${p.payments},${p.operations},${p.quietNight},${p.showAmount})
    on conflict(admin_id) do update set payments=excluded.payments,operations=excluded.operations,
      quiet_night=excluded.quiet_night,show_amount=excluded.show_amount,updated_at=now()`;
}
export async function registerMobileSubscription(adminId: string, subscription: MobileSubscription) {
  const db = getDb();
  return db.begin(async tx => {
    // Serialize device-cap and ownership checks per account.
    await tx`select pg_advisory_xact_lock(hashtext(${"admin-mobile:" + adminId}))`;
    const [count] = await tx`select count(*)::integer as n from shorts_mvp.admin_mobile_subscriptions
      where admin_id=${adminId} and active and endpoint<>${subscription.endpoint}`;
    if (Number(count.n) >= 10) throw new HttpError(409, "연결된 기기가 많아요. 기존 기기 알림을 먼저 꺼주세요.");
    const rows = await tx`insert into shorts_mvp.admin_mobile_subscriptions(admin_id,endpoint,p256dh,auth)
      values(${adminId},${subscription.endpoint},${subscription.keys.p256dh},${subscription.keys.auth})
      on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,active=true,
        active_from=case when shorts_mvp.admin_mobile_subscriptions.active then shorts_mvp.admin_mobile_subscriptions.active_from else now() end,
        updated_at=now()
      where shorts_mvp.admin_mobile_subscriptions.admin_id=excluded.admin_id
      returning id`;
    if (!rows[0]) throw new HttpError(409, "이 기기는 다른 관리자 계정에 연결돼 있어요.");
    return String(rows[0].id);
  });
}
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { eventId: string; title: string; body: string };
export async function sendMobilePush(target: PushTarget, payload: PushPayload) {
  if (!pushConfigured()) throw new HttpError(503, "푸시알림 연결을 준비하고 있어요.");
  if (!allowedPushEndpoint(target.endpoint)) throw new HttpError(400, "지원하지 않는 알림 주소입니다.");
  return webPush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    JSON.stringify(payload), {
      vapidDetails: { subject: process.env.ADMIN_PUSH_VAPID_SUBJECT!, publicKey: process.env.ADMIN_PUSH_VAPID_PUBLIC_KEY!, privateKey: process.env.ADMIN_PUSH_VAPID_PRIVATE_KEY! },
      TTL: 3600, timeout: 8_000, urgency: "normal",
    });
}
export async function testMobilePush(adminId: string, endpoint: string) {
  const db = getDb();
  const rows = await db`update shorts_mvp.admin_mobile_subscriptions set last_test_at=now()
    where admin_id=${adminId} and endpoint=${endpoint} and active
      and (last_test_at is null or last_test_at < now()-interval '1 minute')
    returning id,endpoint,p256dh,auth`;
  if (!rows[0]) throw new HttpError(429, "연결을 확인하거나 1분 후 다시 시도해주세요.");
  const target = rows[0];
  try {
    await sendMobilePush({ endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth },
      { eventId: "test", title: "EasyCut · 연결 완료", body: "이 기기로 결제와 운영 알림을 받을 수 있어요." });
  } catch (error) {
    const code = Number((error as { statusCode?: number }).statusCode || 0);
    if (code === 404 || code === 410) {
      await db`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now() where id=${target.id}`;
      throw new HttpError(410, "알림 연결이 만료됐어요. 다시 켜주세요.");
    }
    throw new HttpError(503, "알림 발송을 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
