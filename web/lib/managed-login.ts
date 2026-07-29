import { createHmac, randomUUID } from "node:crypto";

export const MANAGED_ACCOUNT_PRODUCT_CODE = "managed_account_comp_v1";
export const MANAGED_LOGIN_FAILURE_LIMIT = 5;
export const MANAGED_LOGIN_NETWORK_FAILURE_LIMIT = 20;
export const MANAGED_LOGIN_WINDOW_MINUTES = 15;

export function normalizeManagedLoginId(value: string) {
  return value.trim().toLowerCase();
}

export function isManagedLoginId(value: string) {
  return /^[a-z][a-z0-9._-]{2,31}$/.test(normalizeManagedLoginId(value));
}

export function createManagedAuthEmail() {
  return `managed-${randomUUID()}@accounts.easycut.co.kr`;
}

function fingerprintSecret() {
  return process.env.MANAGED_LOGIN_RATE_LIMIT_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "easycut-managed-login-development";
}

export function managedLoginFingerprint(namespace: "identifier" | "network", value: string) {
  return createHmac("sha256", fingerprintSecret())
    .update(`${namespace}:${value}`)
    .digest("hex");
}

export function managedLoginNetwork(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 100);
}
