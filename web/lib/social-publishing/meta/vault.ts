import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export class MetaVault {
  constructor(private key: Buffer, private appKey: string) {
    if (key.length !== 32) throw new Error("Meta token encryption key is missing.");
  }
  private aad(userId: string, purpose: string) { return Buffer.from(JSON.stringify(["easycut-social-v1", "meta", this.appKey, userId, purpose])); }
  seal(value: string, userId: string, purpose: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(userId, purpose));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }
  open(value: string, userId: string, purpose: string) {
    const [v, iv, tag, data, extra] = value.split(".");
    if (v !== "v1" || !iv || !tag || !data || extra) throw new Error("Invalid encrypted Meta grant.");
    const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    cipher.setAAD(this.aad(userId, purpose)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  }
}
