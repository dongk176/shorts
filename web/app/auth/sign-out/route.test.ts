import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  getSupabaseAuthConfig: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
  getSupabaseAuthConfig: mocks.getSupabaseAuthConfig,
}));

import { POST } from "./route";

describe("POST /auth/sign-out", () => {
  const cookieStore = {
    getAll: vi.fn(() => [
      { name: "shorts_mvp_session", value: "mvp-session" },
      { name: "sb-projectref-auth-token.0", value: "auth-part-0" },
      { name: "sb-projectref-auth-token.1", value: "auth-part-1" },
      { name: "sb-projectref-auth-token-user.0", value: "user-part-0" },
      { name: "unrelated", value: "keep" },
    ]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.getSupabaseAuthConfig.mockReturnValue({
      url: "https://projectref.supabase.co",
      key: "publishable",
    });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  function request({
    clientNavigation = false,
    next = "/settings",
  }: {
    clientNavigation?: boolean;
    next?: string;
  } = {}) {
    return new NextRequest("https://www.easycut.co.kr/auth/sign-out", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(clientNavigation ? { "x-easycut-client-navigation": "1" } : {}),
      },
      body: new URLSearchParams({ next }),
    });
  }

  function expiredCookie(
    headers: string[],
    name: string,
    domain?: string,
  ) {
    return headers.some((header) =>
      header.startsWith(`${name}=;`)
      && header.includes("Max-Age=0")
      && header.includes("Path=/")
      && (domain
        ? header.includes(`Domain=${domain}`)
        : !header.includes("Domain="))
    );
  }

  it("expires auth cookies at every production domain scope and always redirects home", async () => {
    const response = await POST(request());
    const setCookies = response.headers.getSetCookie();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    for (const name of [
      "shorts_mvp_session",
      "sb-projectref-auth-token.0",
      "sb-projectref-auth-token.1",
      "sb-projectref-auth-token-user.0",
    ]) {
      expect(expiredCookie(setCookies, name)).toBe(true);
      expect(expiredCookie(setCookies, name, "www.easycut.co.kr")).toBe(true);
      expect(expiredCookie(setCookies, name, ".easycut.co.kr")).toBe(true);
    }
    expect(setCookies.some((header) => header.startsWith("unrelated="))).toBe(false);
  });

  it("still clears local sessions and redirects when Supabase sign-out fails", async () => {
    mocks.signOut.mockRejectedValue(new Error("temporary auth outage"));

    const response = await POST(request({ next: "/settings" }));
    const setCookies = response.headers.getSetCookie();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/");
    expect(expiredCookie(setCookies, "shorts_mvp_session")).toBe(true);
    expect(expiredCookie(setCookies, "sb-projectref-auth-token.0")).toBe(true);
  });

  it("still clears cookies when Supabase returns a sign-out error", async () => {
    mocks.signOut.mockResolvedValue({ error: new Error("invalid session") });

    const response = await POST(request({ next: "/settings" }));
    const setCookies = response.headers.getSetCookie();

    expect(response.status).toBe(303);
    expect(expiredCookie(setCookies, "shorts_mvp_session")).toBe(true);
    expect(expiredCookie(setCookies, "sb-projectref-auth-token.0", ".easycut.co.kr")).toBe(true);
  });

  it("returns no content for client-controlled navigation so the page can hard-navigate home", async () => {
    const response = await POST(request({ clientNavigation: true }));
    const setCookies = response.headers.getSetCookie();

    expect(response.status).toBe(204);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(expiredCookie(setCookies, "shorts_mvp_session")).toBe(true);
    expect(expiredCookie(setCookies, "sb-projectref-auth-token.0")).toBe(true);
  });
});
