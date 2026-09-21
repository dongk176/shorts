import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaDeletionIdentity = { userId: string; issuedAt: number };

/** Verifies identity only. Caller must enqueue scoped deletion durably before acknowledging it. */
export function verifyMetaDeletionRequest(signedRequest: string, appSecret: string, nowSeconds = Date.now() / 1000): MetaDeletionIdentity {
  const fail = () => new Error("Invalid Meta signed request.");
  if (!appSecret || signedRequest.length > 16_384 || !Number.isFinite(nowSeconds)) throw fail();
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw fail();
  const [encodedSignature, payload] = parts;
  const signature = Buffer.from(encodedSignature, "base64url");
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw fail();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw fail(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const data = value as Record<string, unknown>;
  if (data.algorithm !== "HMAC-SHA256" || typeof data.user_id !== "string"
      || !/^[0-9]{1,100}$/.test(data.user_id) || typeof data.issued_at !== "number"
      || !Number.isSafeInteger(data.issued_at) || data.issued_at <= 0 || data.issued_at > nowSeconds + 300) throw fail();
  if (data.expires !== undefined && (typeof data.expires !== "number" || !Number.isSafeInteger(data.expires)
      || data.expires < 0 || (data.expires !== 0 && data.expires <= nowSeconds))) throw fail();
  return { userId: data.user_id, issuedAt: data.issued_at };
}
