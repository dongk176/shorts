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

  it("leaves unrelated routes unchanged", async () => {
    const response = await middleware(new NextRequest("https://example.com/pricing"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });
});
