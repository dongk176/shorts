import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("canonical URL middleware", () => {
  it("redirects legacy production hosts to the canonical domain", () => {
    const request = new NextRequest("https://shorts-weld-iota.vercel.app/pricing?cycle=yearly");

    const response = middleware(request);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/pricing?cycle=yearly");
  });

  it("permanently redirects the Korean popular alias to the ASCII canonical URL", () => {
    const request = new NextRequest("https://example.com/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%9D%B8%EA%B8%B0?category=education");

    const response = middleware(request);

    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/popular");
    expect(location.search).toBe("?category=education");
  });

  it("serves the ASCII popular canonical route without rewriting it", () => {
    const response = middleware(new NextRequest("https://example.com/popular"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves unrelated routes unchanged", () => {
    const response = middleware(new NextRequest("https://example.com/pricing"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
