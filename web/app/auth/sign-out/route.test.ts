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
  const deleteCookie = vi.fn();
  const cookieStore = {
    delete: deleteCookie,
    getAll: vi.fn(() => [
      { name: "shorts_mvp_session", value: "mvp-session" },
      { name: "sb-projectref-auth-token.0", value: "auth-part-0" },
      { name: "sb-projectref-auth-token.1", value: "auth-part-1" },
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

  function request(next = "/settings") {
    return new NextRequest("https://easycut.example/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ next }),
    });
  }

  it("clears the MVP and chunked Supabase auth cookies before redirecting", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://easycut.example/settings");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(deleteCookie).toHaveBeenCalledWith("shorts_mvp_session");
    expect(deleteCookie).toHaveBeenCalledWith("sb-projectref-auth-token.0");
    expect(deleteCookie).toHaveBeenCalledWith("sb-projectref-auth-token.1");
    expect(deleteCookie).not.toHaveBeenCalledWith("unrelated");
  });

  it("still clears local sessions and redirects when Supabase sign-out fails", async () => {
    mocks.signOut.mockRejectedValue(new Error("temporary auth outage"));

    const response = await POST(request("/"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://easycut.example/");
    expect(deleteCookie).toHaveBeenCalledWith("shorts_mvp_session");
    expect(deleteCookie).toHaveBeenCalledWith("sb-projectref-auth-token.0");
    expect(deleteCookie).toHaveBeenCalledWith("sb-projectref-auth-token.1");
  });
});
