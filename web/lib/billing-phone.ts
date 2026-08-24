import { decryptCardToken, encryptCardToken } from "@/lib/thepayone";

export type EncryptedBillingPhone = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function context(paymentMethodId: string) {
  return `payer-tel:v1:${paymentMethodId}`;
}

export function normalizeBillingPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function isBillingPhone(value: string) {
  return /^\d{10,11}$/.test(normalizeBillingPhone(value));
}

export function encryptBillingPhone(value: string, paymentMethodId: string): EncryptedBillingPhone {
  const normalized = normalizeBillingPhone(value);
  if (!isBillingPhone(normalized)) throw new Error("휴대전화 번호 형식이 올바르지 않습니다.");
  return encryptCardToken(normalized, context(paymentMethodId));
}

export function decryptBillingPhone(value: EncryptedBillingPhone, paymentMethodId: string) {
  const plaintext = decryptCardToken(value, context(paymentMethodId));
  if (!isBillingPhone(plaintext)) throw new Error("저장된 휴대전화 번호 형식이 올바르지 않습니다.");
  return plaintext;
}
