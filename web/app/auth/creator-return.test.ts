import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_NEXT_COOKIE } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signIn: vi.fn(),
  exchangeCode: vi.fn(),
  claimSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/session", () => ({ claimMvpSession: mocks.claimSession }));

import { GET as startLogin } from "./sign-in/route";
import { GET as finishLogin } from "./callback/route";

const origin = "http://127.0.0.1:3108";
const creatorNext = "/creator-support?step=account";
const headers = { Host: "127.0.0.1:3108", "X-Forwarded-Proto": "http" };
function callback(next = creatorNext, cookie?: string) {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("code", "mock-authorization-code");
  url.searchParams.set("next", next);
  const request = new NextRequest(url, { headers });
  if (cookie) request.cookies.set(OAUTH_NEXT_COOKIE, cookie);
  return request;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { signInWithOAuth: mocks.signIn, exchangeCodeForSession: mocks.exchangeCode } });
  mocks.signIn.mockResolvedValue({ data: { url: "https://provider.example/authorize" }, error: null });
  mocks.exchangeCode.mockResolvedValue({ data: { user: { id: "mock-user" } }, error: null });
  mocks.claimSession.mockResolvedValue({});
});

describe("partner application OAuth return", () => {
  it.each(["google", "kakao"])("preserves the application step through %s authorization", async (provider) => {
    const url = new URL("/auth/sign-in", origin);
    url.searchParams.set("provider", provider);
    url.searchParams.set("next", creatorNext);
    const response = await startLogin(new NextRequest(url, { headers }));
    expect(response.status).toBe(302);
    const input = mocks.signIn.mock.calls[0][0];
    const redirect = new URL(input.options.redirectTo);
    expect(input.provider).toBe(provider);
    expect(redirect.origin).toBe(origin);
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("next")).toBe(creatorNext);
    expect(response.cookies.get(OAUTH_NEXT_COOKIE)?.value).toBe(creatorNext);
  });

  it("keeps an unconfigured local login on the partner account screen", async () => {
    mocks.createClient.mockRejectedValue(new Error("auth not configured"));
    const response = await startLogin(new NextRequest(`${origin}/auth/sign-in?provider=google&next=%2Fcreator-support`, { headers }));
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/creator-support");
    expect(target.searchParams.get("step")).toBe("account");
    expect(target.searchParams.get("auth_error")).toBe("AUTH_START_FAILED");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([undefined, creatorNext])("returns a successful login to account confirmation with cookie %s", async (cookie) => {
    const response = await finishLogin(callback(creatorNext, cookie));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}${creatorNext}`);
    expect(mocks.claimSession).toHaveBeenCalledWith({ id: "mock-user" });
    expect(response.headers.get("set-cookie")).toContain("Path=/auth/callback");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("preserves the existing cookie priority for other login flows", async () => {
    const response = await finishLogin(callback(creatorNext, "/projects"));
    expect(response.headers.get("location")).toBe(`${origin}/projects`);
  });

  it("keeps canceled and failed callbacks in the application", async () => {
    mocks.exchangeCode.mockResolvedValue({ data: { user: null }, error: new Error("expired code") });
    const response = await finishLogin(callback());
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/creator-support");
    expect(target.searchParams.get("step")).toBe("account");
    expect(target.searchParams.get("auth_error")).toBe("AUTH_CALLBACK_FAILED");
    expect(mocks.claimSession).not.toHaveBeenCalled();
  });

  it("does not report successful login if session linking fails", async () => {
    mocks.claimSession.mockRejectedValue(new Error("database unavailable"));
    const response = await finishLogin(callback());
    expect(new URL(response.headers.get("location")!).searchParams.get("auth_error")).toBe("AUTH_CALLBACK_FAILED");
  });

  it.each(["https://outside.example", "//outside.example", "/\\outside.example", "/\n/outside.example"])("rejects external query return path %s", async (next) => {
    const response = await finishLogin(callback(next));
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });
});
