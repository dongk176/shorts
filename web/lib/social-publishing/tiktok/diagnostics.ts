import "server-only";
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { safeTikTokErrorCode, type TikTokErrorCode } from "./errors";

export function reportTikTokFailure(stage: string, error: unknown, fallback: TikTokErrorCode = "TIKTOK_UNAVAILABLE") {
  const code = safeTikTokErrorCode(error instanceof HttpError ? error.code : fallback);
  const requestId = randomUUID();
  // Do not log URLs, OAuth codes/state, tokens, user IDs or exception messages.
  const dbCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const sqlState = typeof dbCode === "string" && ["23505", "23503", "23514", "40001", "40P01", "57014", "25P03", "53300"].includes(dbCode) ? dbCode : undefined;
  console.warn("[tiktok] request failed", { stage, code, requestId, ...(sqlState ? { sqlState } : {}) });
  return { code, requestId };
}
