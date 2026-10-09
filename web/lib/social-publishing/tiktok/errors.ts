// Shared allowlist: never reflect provider descriptions, tokens or arbitrary URL text.
export const tiktokErrorKeys = {
  TIKTOK_PAID_PLAN_REQUIRED: "paidPlan", TIKTOK_SETUP_REQUIRED: "setup",
  TIKTOK_MEDIA_SETUP_REQUIRED: "mediaSetup", TIKTOK_URL_OWNERSHIP_UNVERIFIED: "mediaSetup",
  TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS: "privateAccountRequired",
  TIKTOK_RECONNECT_REQUIRED: "reconnectRequired", TIKTOK_ACCESS_TOKEN_INVALID: "reconnectRequired",
  TIKTOK_SCOPE_NOT_AUTHORIZED: "permissionRequired", TIKTOK_PARTIAL_PERMISSION: "permissionRequired",
  TIKTOK_RECONNECT_WAIT: "wait", TIKTOK_INVALID_POST: "reviewSettings",
  TIKTOK_SOURCE_CHANGED: "sourceChanged", TIKTOK_POST_BUSY: "postBusy", TIKTOK_RESULT_UNKNOWN: "unknownNote",
  TIKTOK_ALREADY_LINKED: "alreadyLinked", TIKTOK_STATE_EXPIRED: "connectionExpired",
  TIKTOK_INVALID_GRANT: "authorizationExpired", TIKTOK_AUTH_REMOVED: "reconnectRequired",
  TIKTOK_INVALID_CLIENT: "appConnectionError", TIKTOK_UNAUTHORIZED_CLIENT: "appConnectionError",
  TIKTOK_INVALID_REQUEST: "appConnectionError", TIKTOK_INVALID_SCOPE: "appConnectionError",
  TIKTOK_ACCESS_DENIED: "permissionDenied", TIKTOK_NETWORK_ERROR: "networkError",
  TIKTOK_INVALID_RESPONSE: "providerResponseError", TIKTOK_PROVIDER_ERROR: "providerResponseError",
  TIKTOK_SERVER_ERROR: "providerResponseError", TIKTOK_TEMPORARILY_UNAVAILABLE: "providerResponseError",
  TIKTOK_RATE_LIMIT_EXCEEDED: "rateLimit", TIKTOK_SPAM_RISK_TOO_MANY_POSTS: "postingLimit",
  TIKTOK_SPAM_RISK_USER_BANNED_FROM_POSTING: "postingRestricted", TIKTOK_REACHED_ACTIVE_USER_CAP: "appUserLimit",
  TIKTOK_PRIVACY_LEVEL_OPTION_MISMATCH: "privacyChanged", TIKTOK_VIDEO_PULL_FAILED: "videoPullFailed",
  TIKTOK_DURATION_CHECK_FAILED: "tooLong", TIKTOK_FILE_FORMAT_CHECK_FAILED: "videoFormatFailed",
  TIKTOK_NOT_FOUND: "notFound", TIKTOK_SIGN_IN: "signInAgain", TIKTOK_ORIGIN_INVALID: "signInAgain",
  TIKTOK_SAVE_FAILED: "saveFailed", TIKTOK_UNAVAILABLE: "unknownFailure", TIKTOK_DISABLED: "setup",
} as const;
export type TikTokErrorCode = keyof typeof tiktokErrorKeys;
export function safeTikTokErrorCode(code: unknown): TikTokErrorCode {
  return typeof code === "string" && Object.hasOwn(tiktokErrorKeys, code) ? code as TikTokErrorCode : "TIKTOK_UNAVAILABLE";
}
export function safeTikTokRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : undefined;
}
