import "server-only";
import { HttpError } from "@/lib/http";
import { SCOPES, type Channel } from "./contracts";

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type ChannelCheck = { status: "valid"; title: string } | { status: "revoked" | "retry" };
export class YoutubeAccountGoogle {
  constructor(private config: GoogleConfig, private fetcher: typeof fetch = fetch) {}
  authorization(state: string, challenge: string) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return url.href;
  }
  private request(url: string, init: RequestInit) {
    return this.fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  }
  async revoke(token: string): Promise<boolean> {
    try {
      const response = await this.request("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      // A 400 is not assumed to mean success. Never expose provider error text.
      return response.status === 200;
    } catch { return false; }
  }
  async checkChannel(refreshToken: string, channelId: string): Promise<ChannelCheck> {
    try {
      const response = await this.request("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      });
      const body = await response.json();
      if (response.status === 400 && body.error === "invalid_grant") return { status: "revoked" };
      if (!response.ok || typeof body.access_token !== "string" || !body.access_token) return { status: "retry" };
      const channels = await this.request("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50", { headers: { Authorization: `Bearer ${body.access_token}` } });
      const data = await channels.json();
      if (!channels.ok || !Array.isArray(data.items)) return { status: "retry" };
      const channel = data.items.find((item: { id?: string }) => item.id === channelId);
      // A paginated response is incomplete evidence of a missing channel.
      if (!channel) return { status: data.nextPageToken ? "retry" : "revoked" };
      if (typeof channel.snippet?.title !== "string") return { status: "retry" };
      return { status: "valid", title: channel.snippet.title.slice(0, 255) };
    } catch { return { status: "retry" }; }
  }
  async exchange(code: string, verifier: string, onToken?: (token: string) => void) {
    const r = await this.request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, code_verifier: verifier, client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, grant_type: "authorization_code" }) });
    const b = await r.json();
    if (r.ok && typeof b.refresh_token === "string" && b.refresh_token) onToken?.(b.refresh_token);
    if (!r.ok || typeof b.access_token !== "string" || typeof b.refresh_token !== "string" || !b.refresh_token || SCOPES.some(scope => !(b.scope || "").split(" ").includes(scope))) throw new HttpError(400, "채널 조회와 업로드 권한을 허용하고 다시 연결해 주세요.");
    const response = await this.request("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50", { headers: { Authorization: `Bearer ${b.access_token}` } });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.items)) throw new HttpError(400, "YouTube 채널을 확인하지 못했습니다.");
    const channels: Channel[] = data.items.flatMap((item: { id?: string; snippet?: { title?: string } }) => typeof item.id === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(item.id) && typeof item.snippet?.title === "string" ? [{ channelId: item.id, channelTitle: item.snippet.title.slice(0, 255) }] : []);
    if (!channels.length) throw new HttpError(400, "연결할 YouTube 채널이 없습니다.");
    return { channels, refreshToken: b.refresh_token as string, scopes: SCOPES };
  }
}
