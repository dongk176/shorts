import "server-only";
import { paypalEnabled, paypalEnvironment } from "./api";

export function oneTimeEnabled() {
  return paypalEnabled() && process.env.PAYPAL_ONE_TIME_ENABLED === "true";
}
export function oneTimeReturnOrigin() {
  if (!oneTimeEnabled()) throw Error("One-time checkout is disabled");
  const url = new URL(process.env.PAYPAL_RETURN_ORIGIN || "invalid:");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw Error("Invalid PayPal return origin");
  if (paypalEnvironment() === "live") {
    if (url.origin !== "https://www.easycut.co.kr" || process.env.PAYPAL_LOCAL_FIXTURE_USER || process.env.PAYPAL_ONE_TIME_LOCAL) throw Error("Invalid Live checkout configuration");
  } else {
    const db = new URL(process.env.DATABASE_URL || "invalid:");
    if (process.env.VERCEL || !["localhost", "127.0.0.1"].includes(db.hostname)
      || !["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol !== "http:") throw Error("Sandbox requires an isolated local database");
  }
  return url.origin;
}
