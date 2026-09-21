import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const service = { start: vi.fn(), list: vi.fn(), callback: vi.fn(), create: vi.fn(), disconnect: vi.fn() };
vi.mock("./runtime", () => ({ metaContext: async () => ({ service, actor: { userId: "owner", sessionId: "session" }, config: { platform:"instagram", origin: "https://review.example.com" } }) }));
import { oauthStart, oauthCallback, postsPost, connectionDelete } from "./handlers";
const context = {params:Promise.resolve({platform:"instagram"})};
const origin = "https://review.example.com";
const request = (headers: Record<string, string>, body = "{}") => new Request(origin+"/api/social/instagram/oauth/start", { method: "POST", headers, body });
beforeEach(() => { vi.clearAllMocks(); });
describe("TikTok HTTP boundary", () => {
  it("rejects missing/foreign origins, cross-site requests and non-JSON before OAuth or upload", async () => {
    const cases: Record<string, string>[] = [{ "Content-Type": "application/json" }, { Origin: "https://evil.example", "Content-Type": "application/json" }, { Origin: origin, "Content-Type": "application/json", "sec-fetch-site": "cross-site" }, { Origin: origin, "Content-Type": "text/plain" }];
    for (const headers of cases) {
      const a = await oauthStart(request(headers),context); expect([403, 415]).toContain(a.status);
      const b = await postsPost(request(headers),context); expect([403, 415]).toContain(b.status);
    }
    expect(service.start).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled();
  });
  it("hides provider/server exception details and never caches OAuth responses", async () => {
    service.start.mockRejectedValueOnce(new Error("secret=private-provider-token"));
    const result = await oauthStart(request({ Origin: origin, "Content-Type": "application/json" }),context);
    expect(await result.text()).not.toMatch(/private-provider-token|secret=/);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store"); expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it("requires explicit disconnect confirmation", async () => {
    const result = await connectionDelete(request({ Origin: origin, "Content-Type": "application/json" }), { params: Promise.resolve({ platform:"instagram", connectionId: "id" }) });
    expect(result.status).toBe(400); expect(service.disconnect).not.toHaveBeenCalled();
  });
  it("redirects to the validated locale path with only a sanitized outcome", async () => {
    service.callback.mockResolvedValueOnce({ returnPath: "/en/projects/1", outcome: "connected" });
    const result = await oauthCallback(new Request(origin+"/api/social/instagram/oauth/callback?state=x&code=private"),context);
    expect(result.headers.get("Location")).toBe(origin+"/en/projects/1?instagramAccount=connected");
    expect(result.headers.get("Location")).not.toContain("private");
  });
});
