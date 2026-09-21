import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function challenge() {
  const state = "acct_" + randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  return { state, verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
// The keyring allows old ciphertext to remain readable while new writes use a new key.
export class TokenVault {
  constructor(private keys: Record<string, Buffer>, private activeKey: string) {
    if (!keys[activeKey] || Object.entries(keys).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,32}$/.test(id) || key.length !== 32)) throw new Error("YouTube 연결 암호화 키 설정이 올바르지 않습니다.");
  }
  seal(value: string, userId: string, purpose: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.keys[this.activeKey], iv);
    c.setAAD(Buffer.from(JSON.stringify(["easycut-youtube-account-v1", userId, purpose])));
    const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
    return ["v1", this.activeKey, iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }
  open(value: string, userId: string, purpose: string) {
    const [version, keyId, iv, tag, data, extra] = value.split(".");
    if (version !== "v1" || extra || !this.keys[keyId] || !iv || !tag || !data) throw new Error("저장된 연결을 다시 인증해 주세요.");
    const d = createDecipheriv("aes-256-gcm", this.keys[keyId], Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(JSON.stringify(["easycut-youtube-account-v1", userId, purpose])));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}
