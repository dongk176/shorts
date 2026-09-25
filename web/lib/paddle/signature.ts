import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyPaddleSignature(
  raw: string,
  header: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!secret || !header) return false;
  const parts = header.split(";").map((s) => s.trim().split("="));
  const timestamps = parts.filter(([k]) => k === "ts");
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1] || ""))
    return false;
  const timestamp = timestamps[0][1];
  if (Math.abs(now / 1000 - Number(timestamp)) > 5) return false;
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}:${raw}`)
    .digest();
  return parts
    .filter(([k]) => k === "h1")
    .some(([, value]) => {
      if (!/^[a-f0-9]{64}$/i.test(value || "")) return false;
      return timingSafeEqual(digest, Buffer.from(value, "hex"));
    });
}
