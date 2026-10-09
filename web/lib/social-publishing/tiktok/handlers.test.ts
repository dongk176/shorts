import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ tiktokConfig: () => ({ origin: "https://review.example.com" }) }));
import { HttpError } from "@/lib/http";
const service = { start: vi.fn(), list: vi.fn(), callback: vi.fn(), create: vi.fn(), disconnect: vi.fn() };
vi.mock("./runtime", () => ({ tiktokContext: async () => ({ service, actor: { userId: "owner", sessionId: "session" }, config: { origin: "https://review.example.com" } }) }));
import { oauthStart, oauthCallback, postsPost, connectionDelete } from "./handlers";
const origin = "https://review.example.com";
const request = (headers: Record<string, string>, body = "{}") => new Request(origin+"/api/social/tiktok/oauth/start", { method: "POST", headers, body });
beforeEach(() => { vi.clearAllMocks(); });
describe("TikTok HTTP boundary", () => {
  it("rejects missing/foreign origins, cross-site requests and non-JSON before OAuth or upload", async () => {
    const cases: Record<string, string>[] = [{ "Content-Type": "application/json" }, { Origin: "https://evil.example", "Content-Type": "application/json" }, { Origin: origin, "Content-Type": "application/json", "sec-fetch-site": "cross-site" }, { Origin: origin, "Content-Type": "text/plain" }];
    for (const headers of cases) {
      const a = await oauthStart(request(headers)); expect([403, 415]).toContain(a.status);
      const b = await postsPost(request(headers)); expect([403, 415]).toContain(b.status);
    }
    expect(service.start).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled();
  });
  it("hides provider/server exception details and never caches OAuth responses", async () => {
    service.start.mockRejectedValueOnce(new Error("secret=private-provider-token"));
    const result = await oauthStart(request({ Origin: origin, "Content-Type": "application/json" }));
    expect(await result.text()).not.toMatch(/private-provider-token|secret=/);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store"); expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it("requires explicit disconnect confirmation", async () => {
    const result = await connectionDelete(request({ Origin: origin, "Content-Type": "application/json" }), { params: Promise.resolve({ connectionId: "id" }) });
    expect(result.status).toBe(400); expect(service.disconnect).not.toHaveBeenCalled();
  });
  it("redirects to the validated locale path with only a sanitized outcome", async () => {
    service.callback.mockResolvedValueOnce({ returnPath: "/en/projects/1", outcome: "connected" });
    const result = await oauthCallback(new Request(origin+"/api/social/tiktok/oauth/callback?state=x&code=private"));
    expect(result.headers.get("Location")).toBe(origin+"/en/projects/1?tiktokAccount=connected");
    expect(result.headers.get("Location")).not.toContain("private");
  });
  it("carries only allowlisted failure codes and generated references to the return page", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    service.callback.mockResolvedValueOnce({ returnPath: "/publish/channels", outcome: "failed", errorCode: "TIKTOK_ALREADY_LINKED", requestId });
    const response = await oauthCallback(new Request(origin+"/api/social/tiktok/oauth/callback?code=private"));
    const target = new URL(response.headers.get("Location")!);
    expect(target.searchParams.get("tiktokError")).toBe("TIKTOK_ALREADY_LINKED");
    expect(target.searchParams.get("tiktokRequest")).toBe(requestId);
    service.callback.mockResolvedValueOnce({ returnPath: "/publish/channels", outcome: "failed", errorCode: "access_token=secret", requestId: "private-token" });
    const hidden = await oauthCallback(new Request(origin+"/api/social/tiktok/oauth/callback"));
    expect(hidden.headers.get("Location")).toContain("TIKTOK_UNAVAILABLE");
    expect(hidden.headers.get("Location")).not.toMatch(/secret|private-token|tiktokRequest/);
  });

  it("returns OAuth exceptions to the trusted app page instead of a JSON dead end", async () => {
    service.callback.mockRejectedValueOnce(new HttpError(401, "private session detail", "HTTP_401"));
    const response = await oauthCallback(new Request("https://untrusted.example/api/social/tiktok/oauth/callback?code=secret"));
    const target = new URL(response.headers.get("Location")!);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/publish/channels");
    expect(target.searchParams.get("tiktokError")).toBe("TIKTOK_SIGN_IN");
    expect(response.status).toBe(303);
    expect(target.href).not.toMatch(/untrusted|secret|private/);
  });

});
