import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { TossBillingConfigurationError } from "@/lib/toss-billing-config";

export type EncryptedTossBillingKey = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function encryptionKey() {
  const raw = process.env.TOSS_BILLING_KEY_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new TossBillingConfigurationError(
      "TOSS_BILLING_KEY_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.",
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (
    decoded.length !== 32
    || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")
  ) {
    throw new TossBillingConfigurationError(
      "TOSS_BILLING_KEY_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.",
    );
  }
  return decoded;
}
export function tossBillingKeyContext(userId: string, paymentMethodId: string) {
  return `toss-billing-key:v1:${userId}:${paymentMethodId}`;
}

export function encryptTossBillingKey(
  billingKey: string,
  context: string,
): EncryptedTossBillingKey {
  if (!billingKey || billingKey.length > 256) {
    throw new Error("토스 빌링키 형식이 올바르지 않습니다.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(billingKey, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptTossBillingKey(
  encrypted: EncryptedTossBillingKey,
  context: string,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  if (!plaintext || plaintext.length > 256) {
    throw new Error("저장된 토스 빌링키 형식이 올바르지 않습니다.");
  }
  return plaintext;
}

export function tossBillingKeyHash(billingKey: string) {
  return createHash("sha256").update(billingKey, "utf8").digest("hex");
}
