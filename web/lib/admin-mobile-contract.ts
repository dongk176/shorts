import { z } from "zod";

export const preferenceSchema = z.object({
  payments: z.boolean(), operations: z.boolean(), quietNight: z.boolean(), showAmount: z.boolean(),
});
export type MobilePreferences = z.infer<typeof preferenceSchema>;
export const defaultMobilePreferences: MobilePreferences = {
  payments: true, operations: true, quietNight: true, showAmount: true,
};
export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.hash && (
        url.hostname === "web.push.apple.com" || url.hostname.endsWith(".push.apple.com")
        || url.hostname === "fcm.googleapis.com"
        || url.hostname === "updates.push.services.mozilla.com"
        || url.hostname.endsWith(".notify.windows.com")
      );
  } catch { return false; }
}
export const endpointSchema = z.string().min(20).max(2048).refine(allowedPushEndpoint);
export const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/).refine(value => {
      const key = Buffer.from(value, "base64url");
      return key.length === 65 && key[0] === 4;
    }),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/).refine(value => Buffer.from(value, "base64url").length === 16),
  }),
});
export type MobileSubscription = z.infer<typeof subscriptionSchema>;
export function isQuietHour(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(date));
  return hour >= 23 || hour < 8;
}
export function shouldNotify(kind: string, preferences: MobilePreferences, now: Date) {
  if (kind === "payment" ? !preferences.payments : !preferences.operations) return false;
  return kind === "urgent" || !preferences.quietNight || !isQuietHour(now);
}
export function pushConfigured() {
  return process.env.ADMIN_MOBILE_ENABLED === "1"
    && Boolean(process.env.ADMIN_PUSH_VAPID_PUBLIC_KEY && process.env.ADMIN_PUSH_VAPID_PRIVATE_KEY
      && process.env.ADMIN_PUSH_VAPID_SUBJECT);
}
