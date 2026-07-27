import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseAuthConfig: mocks.getConfig,
}));

import { refreshSupabaseSession } from "./middleware";

type CookieAdapter = {
  cookies: {
    getAll(): Array<{ name: string; value: string }>;
    setAll(
      values: Array<{ name: string; value: string; options: { path?: string } }>,
      headers: Record<string, string>,
    ): void;
  };
};

describe("refreshSupabaseSession", () => {
  let adapter: CookieAdapter;

  beforeEach(() => {
    mocks.createServerClient.mockReset();
    mocks.getClaims.mockReset();
    mocks.getConfig.mockReset();
    mocks.getConfig.mockReturnValue({ url: "https://project.supabase.co", key: "publishable" });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      adapter = options as CookieAdapter;
      return { auth: { getClaims: mocks.getClaims } };
    });
  });

  it("writes refreshed auth cookies to the request and browser response", async () => {
    mocks.getClaims.mockImplementation(async () => {
      expect(adapter.cookies.getAll()).toContainEqual({ name: "sb-test-auth-token", value: "old" });
      adapter.cookies.setAll(
        [{ name: "sb-test-auth-token", value: "new", options: { path: "/" } }],
        { "Cache-Control": "private, no-store" },
      );
      return { data: { claims: { sub: "user" } }, error: null };
    });
    const request = new NextRequest("https://www.easycut.co.kr/pricing", {
      headers: { cookie: "sb-test-auth-token=old" },
    });

    const response = await refreshSupabaseSession(request);

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("new");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("skips Supabase when auth is not configured", async () => {
    mocks.getConfig.mockReturnValue(null);

    const response = await refreshSupabaseSession(new NextRequest("https://www.easycut.co.kr/pricing"));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("continues the request when session refresh has a transport failure", async () => {
    mocks.getClaims.mockRejectedValue(new Error("network unavailable"));
    const request = new NextRequest("https://www.easycut.co.kr/settings");

    const response = await refreshSupabaseSession(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
