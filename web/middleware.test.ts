import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  refreshSupabaseSession: mocks.refreshSession,
}));

import { middleware } from "./middleware";

describe("canonical URL middleware", () => {
  beforeEach(() => {
    mocks.refreshSession.mockReset();
    mocks.refreshSession.mockImplementation(async (request: NextRequest) => NextResponse.next({ request }));
  });

  it("redirects legacy production hosts to the canonical domain", async () => {
    const request = new NextRequest("https://shorts-weld-iota.vercel.app/pricing?cycle=yearly");

    const response = await middleware(request);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/pricing?cycle=yearly");
  });

  it("permanently redirects the Korean popular alias to the ASCII canonical URL", async () => {
    const request = new NextRequest("https://example.com/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%9D%B8%EA%B8%B0?category=education");

    const response = await middleware(request);

    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/popular");
    expect(location.search).toBe("?category=education");
  });

  it("serves the ASCII popular canonical route without rewriting it", async () => {
    const response = await middleware(new NextRequest("https://example.com/popular"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it.each(["404", "500"])(
    "redirects the reserved /%s project URL to the collision-free route",
    async (projectNumber) => {
      const response = await middleware(
        new NextRequest(`https://example.com/${projectNumber}?from=legacy`),
      );

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://example.com/projects/${projectNumber}?from=legacy`,
      );
      expect(mocks.refreshSession).not.toHaveBeenCalled();
    },
  );

  it("redirects a legacy project editor URL to the canonical project route", async () => {
    const response = await middleware(
      new NextRequest("https://example.com/500/edit/short-1"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://example.com/projects/500/edit/short-1",
    );
  });

  it("does not redirect an already canonical project URL", async () => {
    const response = await middleware(
      new NextRequest("https://example.com/projects/500"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it("does not refresh the Supabase session during sign-out", async () => {
    const request = new NextRequest("https://www.easycut.co.kr/auth/sign-out", {
      method: "POST",
    });

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it.each([
    ["next-router-prefetch", "1"],
    ["purpose", "prefetch"],
    ["sec-purpose", "prefetch;prerender"],
  ])("short-circuits legacy admin prefetch requests carrying %s", async (name, value) => {
    const request = new NextRequest(
      "https://www.easycut.co.kr/admin/easycutcutcutcutcutcut?tab=members",
      { headers: { [name]: value } },
    );

    const response = await middleware(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it.each([
    "/projects/5743",
    "/projects/5743/edit/11111111-1111-4111-8111-111111111111",
    "/templates/new?preset=subtitle-pop",
    "/templates/11111111-1111-4111-8111-111111111111/edit",
  ])("short-circuits database-heavy page prefetch for %s", async (path) => {
    const request = new NextRequest(`https://www.easycut.co.kr${path}`, {
      headers: { "next-router-prefetch": "1" },
    });

    const response = await middleware(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("continues to authenticate real template editor navigation", async () => {
    const request = new NextRequest(
      "https://www.easycut.co.kr/templates/new?preset=subtitle-pop",
    );

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it("continues to authenticate real admin navigation requests", async () => {
    const request = new NextRequest(
      "https://www.easycut.co.kr/admin/easycutcutcutcutcutcut?tab=members",
    );

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it("leaves unrelated routes unchanged", async () => {
    const response = await middleware(new NextRequest("https://example.com/pricing"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });
});


describe("locale routing boundaries", () => {
  beforeEach(() => {
    mocks.refreshSession.mockReset();
    mocks.refreshSession.mockImplementation(async (request: NextRequest, rewriteUrl?: URL, headers = request.headers) => rewriteUrl
      ? NextResponse.rewrite(rewriteUrl, { request: { headers } })
      : NextResponse.next({ request: { headers } }));
  });
  it.each([["/jp/faq?cycle=yearly", "ja", "/faq?cycle=yearly"], ["/en", "en", "/"]])("rewrites %s with a validated locale", async (path, locale, target) => {
    const response = await middleware(new NextRequest(`https://www.easycut.co.kr${path}`, { headers: { "x-easycut-site-locale": "ko", cookie: "easycut_locale=ko" } }));
    expect(response.headers.get("x-middleware-rewrite")).toBe(`https://www.easycut.co.kr${target}`);
    expect(response.headers.get("x-middleware-request-x-easycut-site-locale")).toBe(locale);
  });
  it.each([["/jp/pricing","ja"],["/en/pricing","en"],["/jp/settings/plan","ja"],["/en/billing/paddle","en"]])("keeps billing alias %s without a second rewrite",async (path,locale)=> {
    const response=await middleware(new NextRequest(`https://www.easycut.co.kr${path}`,{headers:{"x-easycut-site-locale":"ko"}}));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-easycut-site-locale")).toBe(locale);
  });
  it("honors an explicitly saved language at root instead of a spoofed locale header", async () => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/", { headers: { "x-easycut-site-locale": "ja", cookie: "easycut_locale=en" } }));
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/en");
    expect(response.status).toBe(307);
  });
  it.each(["/jp/api/jobs", "/en/admin/easycutcutcutcutcutcut", "/jp/auth/callback", "/jp/content-calendar", "/jp/east-cut-logo.png"])("rejects prefixed shared route %s", async (path) => {
    const response = await middleware(new NextRequest(`https://www.easycut.co.kr${path}`));
    expect(response.status).toBe(404);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
  it("keeps legacy project redirects in the same language", async () => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/jp/123/edit/abc?preview=1"));
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/jp/projects/123/edit/abc?preview=1");
  });
  it("retains database prefetch protection for localized project pages", async () => {
    const response = await middleware(new NextRequest("https://www.easycut.co.kr/jp/projects/123", { headers: { "next-router-prefetch": "1" } }));
    expect(response.status).toBe(204);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
});
