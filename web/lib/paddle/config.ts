import { HttpError } from "@/lib/http";
import { paddlePlans, isNewJpyPlan, type PaddleCurrency } from "./catalog";
export function paddleConfigured() {
  return ["sandbox", "live"].includes(process.env.PADDLE_ENVIRONMENT || "");
}
export function paddleEnabled() {
  return process.env.PADDLE_ENABLED === "true";
}
export function paddleEnvironment() {
  const value = process.env.PADDLE_ENVIRONMENT;
  if (value !== "sandbox" && value !== "live")
    throw new Error("Paddle environment must be explicit");
  if (value === "sandbox" && process.env.DATABASE_URL) {
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      throw new Error("Sandbox payments require an isolated local database");
  }
  if (value === "sandbox" && process.env.VERCEL_ENV === "production")
    throw new Error("Sandbox cannot run on production");
  return value;
}
export function assertPaddleEnabled() {
  if (!paddleEnabled())
    throw new HttpError(
      503,
      "Payments are not available yet.",
      "PADDLE_DISABLED",
    );
}
export function paddlePriceId(code: string, currency: PaddleCurrency) {
  if (isNewJpyPlan(code) && currency !== "JPY") throw new Error("JPY price cannot be used with another currency");
  const value =
    process.env[
      `PADDLE_PRICE_${code.replace("paddle_", "").toUpperCase()}_${currency}`
    ];
  if (!value || !/^pri_[a-z0-9]{26}$/.test(value))
    throw new Error("Paddle price is not configured");
  return value;
}
export function paddlePriceMatch(priceId: string, currency: PaddleCurrency) {
  return paddlePlans.find((p) => (!isNewJpyPlan(p.code) || currency === "JPY") && paddlePriceId(p.code, currency) === priceId);
}
export function paddleApiKey() {
  const key = process.env.PADDLE_API_KEY || "";
  const prefix =
    paddleEnvironment() === "sandbox" ? "pdl_sdbx_apikey_" : "pdl_live_apikey_";
  if (!key.startsWith(prefix))
    throw new Error("Paddle API key environment mismatch");
  return key;
}
export function paddleClientToken() {
  const token = process.env.PADDLE_CLIENT_TOKEN || "";
  if (
    !token.startsWith(paddleEnvironment() === "sandbox" ? "test_" : "live_")
  ) {
    throw new Error("Paddle client token environment mismatch");
  }
  return token;
}
