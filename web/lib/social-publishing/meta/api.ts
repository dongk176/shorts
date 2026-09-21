import "server-only";
import { HttpError } from "@/lib/http";
import type { MetaConfig } from "./config";
import type { Tokens } from "./contracts";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const lifetime = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 366 * 86400;
const identifier = (raw: unknown) => { const value = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw; if (typeof value !== "string" || !/^\d{1,64}$/.test(value)) throw new MetaApiError("META_PROVIDER_RESPONSE", true); return value; };
type MetaDiagnostic = {
  stage: "authorization_code" | "long_token" | "grant_validation" | "profile" | "permissions" | "graph";
  status?: number; providerCode?: number; providerSubcode?: number;
  permissionsShape?: "string" | "array" | "missing" | "other";
  requiredGranted?: boolean[];
};
export class MetaApiError extends HttpError {
  constructor(code: string, readonly ambiguous = false, readonly diagnostic?: MetaDiagnostic) { super(502, "The platform could not complete this request.", code); }
}

export class MetaApi {
  constructor(readonly config: MetaConfig, private fetcher: typeof fetch = fetch) {}
  private get host() { return this.config.platform === "instagram" ? "https://graph.instagram.com" : "https://graph.threads.com"; }
  private get graph() { return this.host + (this.config.platform === "instagram" ? `/${this.config.graphVersion}` : "/v1.0"); }
  private async request(url: URL, method: string, params: Record<string, string> = {}, token?: string): Promise<Json> {
    // Never record URL queries, response messages, account IDs, or token values.
    const stage: MetaDiagnostic["stage"] = url.pathname === "/oauth/access_token" ? "authorization_code" : url.pathname === "/access_token" ? "long_token" : url.pathname.endsWith("/permissions") || url.pathname.endsWith("/debug_token") ? "permissions" : url.pathname.endsWith("/me") ? "profile" : "graph";
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const init: RequestInit = { method, headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) };
    if (method === "GET") for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    else { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(params).toString(); }
    let response: Response;
    try { response = await this.fetcher(url, init); } catch { throw new MetaApiError("META_RESULT_UNKNOWN", true, { stage }); }
    let data: Json;
    try {
      // Meta returns numeric user IDs larger than JavaScript's safe integer range.
      // Tokenize strings and numbers so quoted strings are never rewritten.
      const raw = await response.text();
      if (raw.length > 1_000_000) throw new Error("Oversized response");
      data = object(JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        part => /^-?\d+$/.test(part) && !Number.isSafeInteger(Number(part)) ? JSON.stringify(part) : part)));
    } catch { throw new MetaApiError("META_PROVIDER_RESPONSE", true, { stage, status: response.status }); }
    const error = object(data.error);
    if (!response.ok || data.error) {
      const code = Number(error.code ?? data.code), subcode = Number(error.error_subcode);
      throw new MetaApiError(code === 190 || response.status === 401 ? "META_RECONNECT_REQUIRED" : code === 10 || code === 200 || response.status === 403 ? "META_PERMISSION_REQUIRED" : response.status === 429 || code === 4 || code === 32 ? "META_RATE_LIMIT" : "META_PROVIDER_REJECTED", response.status >= 500,
        { stage, status: response.status, ...(Number.isSafeInteger(code) ? { providerCode: code } : {}), ...(Number.isSafeInteger(subcode) ? { providerSubcode: subcode } : {}) });
    }
    return data;
  }
  authorization(state: string) {
    const url = new URL(this.config.platform === "instagram" ? "https://www.instagram.com/oauth/authorize" : "https://threads.com/oauth/authorize");
    for (const [key, value] of Object.entries({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: "code", scope: this.config.scopes.join(","), state })) url.searchParams.set(key, value);
    return url.href;
  }
  async exchange(code: string): Promise<Tokens> {
    const raw = await this.request(new URL(this.config.platform === "instagram" ? "https://api.instagram.com/oauth/access_token" : `${this.host}/oauth/access_token`), "POST", {
      client_id: this.config.clientId, client_secret: this.config.clientSecret, code, grant_type: "authorization_code", redirect_uri: this.config.redirectUri,
    });
    const first = Array.isArray(raw.data) ? object(raw.data[0]) : raw;
    const access = first.access_token;
    if (typeof access !== "string" || !access) throw new MetaApiError("META_PROVIDER_RESPONSE");
    try {
      const openId = identifier(first.user_id);
      const long = await this.request(new URL(`${this.host}/access_token`), "GET", {
        grant_type: this.config.platform === "instagram" ? "ig_exchange_token" : "th_exchange_token", client_secret: this.config.clientSecret, access_token: access,
      });
      const accessToken = typeof long.access_token === "string" ? long.access_token : "";
      if (!accessToken || !lifetime(long.expires_in)) throw new MetaApiError("META_PROVIDER_RESPONSE");
      const granted = this.config.platform === "instagram"
        ? (typeof first.permissions === "string" ? first.permissions.split(",") : []).map(scope => scope.trim())
        : await this.permissions(accessToken);
      if (this.config.scopes.some(scope => !granted.includes(scope))) throw new MetaApiError("META_PERMISSION_REQUIRED", false, {
        stage: "grant_validation", permissionsShape: typeof first.permissions === "string" ? "string" : Array.isArray(first.permissions) ? "array" : first.permissions == null ? "missing" : "other",
        requiredGranted: this.config.scopes.map(scope => granted.includes(scope)),
      });
      return { accessToken, openId, scopes: granted, expiresAt: Date.now() + Number(long.expires_in) * 1000 };
    } catch (error) { await this.revoke(access); throw error; }
  }
  async permissions(token: string) {
    if (this.config.platform === "threads") {
      const result = await this.request(new URL(`${this.graph}/debug_token`), "GET", { input_token: token }, token);
      const data = object(result.data);
      if (data.is_valid !== true || !Array.isArray(data.scopes)) throw new MetaApiError("META_RECONNECT_REQUIRED");
      return data.scopes.filter((scope): scope is string => typeof scope === "string");
    }
    throw new MetaApiError("META_PERMISSION_REQUIRED");
  }
  async profile(token: string) {
    const fields = this.config.platform === "instagram" ? "user_id,username,name,account_type" : "id,username";
    const result = await this.request(new URL(`${this.graph}/me`), "GET", { fields }, token);
    const data = Array.isArray(result.data) ? object(result.data[0]) : result;
    if (this.config.platform === "instagram" && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(String(data.account_type))) throw new MetaApiError("META_PROFESSIONAL_REQUIRED");
    const username = typeof data.username === "string" ? data.username : "";
    if (!/^[A-Za-z0-9._]{1,64}$/.test(username)) throw new MetaApiError("META_PROVIDER_RESPONSE");
    return { openId: identifier(data.user_id || data.id), username, nickname: typeof data.name === "string" && data.name ? data.name.slice(0, 255) : username };
  }
  async refresh(tokens: Tokens) {
    const data = await this.request(new URL(`${this.host}/refresh_access_token`), "GET", { grant_type: this.config.platform === "instagram" ? "ig_refresh_token" : "th_refresh_token", access_token: tokens.accessToken });
    if (typeof data.access_token !== "string" || !lifetime(data.expires_in)) throw new MetaApiError("META_RECONNECT_REQUIRED");
    return { ...tokens, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  }
  async container(token: string, openId: string, caption: string, videoUrl: string) {
    const instagram = this.config.platform === "instagram";
    return identifier((await this.request(new URL(`${this.graph}/${identifier(openId)}/${instagram ? "media" : "threads"}`), "POST", {
      media_type: instagram ? "REELS" : "VIDEO", video_url: videoUrl, [instagram ? "caption" : "text"]: caption,
      ...(instagram ? { share_to_feed: "false" } : {}),
    }, token)).id);
  }
  async status(token: string, containerId: string) {
    const field = this.config.platform === "instagram" ? "status_code" : "status";
    const data = await this.request(new URL(`${this.graph}/${identifier(containerId)}`), "GET", { fields: field }, token);
    const status = String(data[field]);
    if (!["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"].includes(status)) throw new MetaApiError("META_PROVIDER_RESPONSE");
    return status;
  }
  async publish(token: string, openId: string, containerId: string) {
    return identifier((await this.request(new URL(`${this.graph}/${identifier(openId)}/${this.config.platform === "instagram" ? "media_publish" : "threads_publish"}`), "POST", { creation_id: identifier(containerId) }, token)).id);
  }
  async permalink(token: string, id: string) {
    const data = await this.request(new URL(`${this.graph}/${identifier(id)}`), "GET", { fields: "permalink" }, token);
    try {
      const url = new URL(String(data.permalink));
      const hosts = this.config.platform === "instagram" ? ["www.instagram.com", "instagram.com"] : ["www.threads.com", "threads.com", "www.threads.net", "threads.net"];
      return url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  async revoke(token: string) {
    try { const result = await this.request(new URL(`${this.graph}/me/permissions`), "DELETE", {}, token); return result.success === true; } catch { return false; }
  }
}
