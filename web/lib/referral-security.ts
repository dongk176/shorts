import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);

export type ReferralPasswordHash = {
  hash: string;
  salt: string;
};

export type EncryptedReferralAccount = {
  ciphertext: string;
  iv: string;
  tag: string;
  last4: string;
};

export function referralTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createReferralToken() {
  return randomBytes(32).toString("base64url");
}

function normalizedPassword(value: string) {
  return value.normalize("NFKC");
}

export async function createReferralPasswordHash(password: string): Promise<ReferralPasswordHash> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(normalizedPassword(password), salt, 64) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyReferralPassword(
  password: string,
  storedHash: string,
  salt: string,
) {
  if (!/^[0-9a-f]{128}$/.test(storedHash) || !/^[0-9a-f]{32}$/.test(salt)) {
    return false;
  }
  const derived = await scrypt(normalizedPassword(password), salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(storedHash, "hex"));
}

function referralSecuritySecret() {
  const secret = process.env.REFERRAL_SECURITY_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("REFERRAL_SECURITY_SECRET은 32자 이상이어야 합니다.");
  }
  return secret;
}

export function referralRateLimitHash(value: string) {
  return createHmac("sha256", referralSecuritySecret()).update(value).digest("hex");
}

function referralEncryptionKey() {
  const raw = process.env.REFERRAL_DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("REFERRAL_DATA_ENCRYPTION_KEY가 설정되지 않았습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("REFERRAL_DATA_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.");
  }
  return key;
}

export function normalizeReferralAccountNumber(value: string) {
  return value.replace(/\D/g, "");
}

export function isReferralAccountNumber(value: string) {
  return /^\d{8,20}$/.test(normalizeReferralAccountNumber(value));
}

export function encryptReferralAccountNumber(
  accountNumber: string,
  partnerId: string,
): EncryptedReferralAccount {
  const normalized = normalizeReferralAccountNumber(accountNumber);
  if (!isReferralAccountNumber(normalized)) {
    throw new Error("계좌번호 형식이 올바르지 않습니다.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referralEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(`referral-account:v1:${partnerId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    last4: normalized.slice(-4),
  };
}

export function decryptReferralAccountNumber(
  encrypted: Omit<EncryptedReferralAccount, "last4">,
  partnerId: string,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    referralEncryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(`referral-account:v1:${partnerId}`, "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  if (!isReferralAccountNumber(plaintext)) {
    throw new Error("저장된 계좌번호 형식이 올바르지 않습니다.");
  }
  return plaintext;
}
