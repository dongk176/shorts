import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./app/api/locale/route";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/middleware", () => ({ refreshSupabaseSession: refresh }));
import { middleware } from "./middleware";

describe("country-aware home entry", () => {
  beforeEach(() => {
    refresh.mockReset().mockImplementation(async (request: NextRequest, rewrite?: URL, headers = request.headers) => rewrite
      ? NextResponse.rewrite(rewrite, { request: { headers } })
      : NextResponse.next({ request: { headers } }));
  });
  it.each([["JP", "/jp"], ["US", "/en"], ["FR", "/en"]])("redirects %s temporarily and preserves campaign query", async (country, path) => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/?utm_source=ad&next=%2Fprojects", { headers: { "x-vercel-ip-country": country } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`https://www.easycut.co.kr${path}?utm_source=ad&next=%2Fprojects`);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each(["KR", "JP"])("manual Korean selection stays Korean in %s without looping", async (country) => {
    const saved = await POST(new Request("https://www.easycut.co.kr/api/locale", { method: "POST", body: JSON.stringify({ locale: "ko" }) }));
    const cookie = saved.headers.get("set-cookie")!.split(";")[0];
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/", { headers: { cookie, "x-vercel-ip-country": country } }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-easycut-site-locale")).toBe("ko");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["/jp", "/en", "/jp/pricing", "/pricing", "/projects/123", "/auth/callback?code=example", "/api/paddle/webhook"])("never geo-redirects explicit/non-entry route %s", async (path) => {
    const response = await middleware(new NextRequest(`https://www.easycut.co.kr${path}`, { headers: { "x-vercel-ip-country": "US", cookie: "easycut_locale=ko" } }));
    expect(response.headers.get("location")).toBeNull();
  });
  it("does not redirect POST (including server actions)", async () => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/", { method: "POST", headers: { "x-vercel-ip-country": "JP" } }));
    expect(response.headers.get("location")).toBeNull();
  });
  it("resolves HEAD and browser prefetch to the same destination as a visit", async () => {
    for (const options of [{ method: "HEAD" }, { headers: { "next-router-prefetch": "1" } }]) {
      const response = await middleware(new NextRequest("https://www.easycut.co.kr/", { ...options, headers: { ...options.headers, "x-vercel-ip-country": "JP" } }));
      expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/jp");
    }
  });
  it.each(["Googlebot", "bingbot", "facebookexternalhit", "Twitterbot"])("keeps crawler %s on its requested root", async (agent) => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/", { headers: { "user-agent": agent, "x-vercel-ip-country": "US" } }));
    expect(response.headers.get("location")).toBeNull();
  });
  it("uses browser Japanese locally when Vercel geo is unavailable", async () => {
    const response = await middleware(new NextRequest("http://localhost:3426/", { headers: { "accept-language": "ja-JP,en;q=0.8" } }));
    expect(response.headers.get("location")).toBe("http://localhost:3426/jp");
  });
  it("keeps a no-signal local root Korean", async () => {
    const response = await middleware(new NextRequest("http://localhost:3426/"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-easycut-site-locale")).toBe("ko");
  });
});
