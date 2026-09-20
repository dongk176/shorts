import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { scopes, type Creator, type PostInput, type Tokens } from "./contracts";

const tokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), open_id: z.string().min(1).max(128), scope: z.string(), expires_in: z.number().positive(), refresh_expires_in: z.number().positive() });
const creatorResponse = z.object({ creator_username: z.string().max(255), creator_nickname: z.string().min(1).max(255), privacy_level_options: z.array(z.string()).min(1), max_video_post_duration_sec: z.number().positive(), comment_disabled: z.boolean(), duet_disabled: z.boolean(), stitch_disabled: z.boolean() });
const knownErrors = new Set(["access_token_invalid", "scope_not_authorized", "rate_limit_exceeded", "spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap", "unaudited_client_can_only_post_to_private_accounts", "url_ownership_unverified", "privacy_level_option_mismatch", "invalid_grant", "auth_removed", "video_pull_failed", "duration_check_failed", "file_format_check_failed"]);
export const safeProviderCode = (code: unknown) => typeof code === "string" && knownErrors.has(code) ? code : "provider_error";
export class TikTokApiError extends HttpError {
  constructor(code: unknown, public readonly ambiguous = false) { super(502, "TikTok could not complete this request.", `TIKTOK_${safeProviderCode(code).toUpperCase()}`); }
}

export class TikTokApi {
  constructor(private config: { clientKey: string; clientSecret: string; redirectUri: string }, private fetcher: typeof fetch = fetch) {}
  authorization(state: string) {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({ client_key: this.config.clientKey, scope: scopes.join(","), response_type: "code", redirect_uri: this.config.redirectUri, state }).toString();
    return url.toString();
  }
  private async request(path: string, body: URLSearchParams | Record<string, unknown>, accessToken?: string) {
    let response: Response;
    try {
      response = await this.fetcher(`https://open.tiktokapis.com/v2/${path}`, {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json; charset=UTF-8", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
      });
    } catch { throw new TikTokApiError("network_error", true); }
    let result;
    try { result = await response.json(); } catch { throw new TikTokApiError("invalid_response", true); }
    const code = typeof result.error === "string" ? result.error : result.error?.code;
    if (!response.ok || (code && code !== "ok")) throw new TikTokApiError(code, response.status >= 500);
    return result;
  }
  private tokens(raw: unknown): Tokens {
    let result;
    try { result = tokenResponse.parse(raw); } catch { throw new TikTokApiError("invalid_response", true); }
    return { accessToken: result.access_token, refreshToken: result.refresh_token, openId: result.open_id, scopes: result.scope.split(","), accessExpiresAt: Date.now() + result.expires_in * 1000, refreshExpiresAt: Date.now() + result.refresh_expires_in * 1000 };
  }
  async exchange(code: string) {
    // TikTok Web does not use Google's PKCE protocol; state is session-bound in our DB.
    return this.tokens(await this.request("oauth/token/", new URLSearchParams({ client_key: this.config.clientKey, client_secret: this.config.clientSecret, grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri })));
  }
  async refresh(refreshToken: string) {
    return this.tokens(await this.request("oauth/token/", new URLSearchParams({ client_key: this.config.clientKey, client_secret: this.config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken })));
  }
  async revoke(accessToken: string) {
    try { await this.request("oauth/revoke/", new URLSearchParams({ client_key: this.config.clientKey, client_secret: this.config.clientSecret, token: accessToken })); return true; } catch { return false; }
  }
  async creator(accessToken: string, connectionId: string): Promise<Creator> {
    const response = await this.request("post/publish/creator_info/query/", {}, accessToken);
    let c;
    try { c = creatorResponse.parse(response.data); } catch { throw new TikTokApiError("invalid_response"); }
    return { connectionId, fetchedAtMs: Date.now(), nickname: c.creator_nickname, username: c.creator_username, privacyOptions: c.privacy_level_options, maxDurationSeconds: c.max_video_post_duration_sec, commentDisabled: c.comment_disabled, duetDisabled: c.duet_disabled, stitchDisabled: c.stitch_disabled };
  }
  async init(accessToken: string, input: PostInput, videoUrl: string) {
    const result = await this.request("post/publish/video/init/", {
      post_info: { title: input.title, privacy_level: input.privacy, disable_comment: !input.allowComments, disable_duet: !input.allowDuet, disable_stitch: !input.allowStitch, brand_organic_toggle: input.yourBrand, brand_content_toggle: input.brandedContent, is_aigc: input.isAigc },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }, accessToken);
    const parsed = z.object({ publish_id: z.string().min(1).max(64) }).safeParse(result.data);
    if (!parsed.success) throw new TikTokApiError("invalid_response", true);
    return parsed.data.publish_id;
  }
  async status(accessToken: string, publishId: string) {
    const result = await this.request("post/publish/status/fetch/", { publish_id: publishId }, accessToken);
    const data = z.object({ status: z.enum(["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"]), fail_reason: z.string().optional() }).safeParse(result.data);
    if (!data.success) throw new TikTokApiError("invalid_response");
    return { status: data.data.status === "PUBLISH_COMPLETE" ? "complete" as const : data.data.status === "FAILED" ? "failed" as const : "processing" as const, errorCode: data.data.status === "FAILED" ? `TIKTOK_${safeProviderCode(data.data.fail_reason).toUpperCase()}` : null };
  }
}
