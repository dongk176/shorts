import { z } from "zod";

export const nativeDeviceSchema = z.object({
  installationId: z.string().uuid(),
  token: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: z.enum(["development", "production"]),
});
export const nativeAuthSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,100}$/),
});
export const nativeExchangeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});
export const nativeInstallationSchema = z.string().uuid();
export function apnsConfigured() {
  return process.env.ADMIN_MOBILE_ENABLED === "1" && Boolean(
    process.env.ADMIN_APNS_KEY_ID && process.env.ADMIN_APNS_TEAM_ID
    && process.env.ADMIN_APNS_PRIVATE_KEY && process.env.ADMIN_APNS_TOPIC,
  );
}
