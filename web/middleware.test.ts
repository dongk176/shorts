import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("localized popular route middleware", () => {
  it("rewrites the percent-encoded Korean path without changing public navigation", () => {
    const request = new NextRequest("https://example.com/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%9D%B8%EA%B8%B0");

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe("https://example.com/popular");
  });

  it("leaves unrelated routes unchanged", () => {
    const response = middleware(new NextRequest("https://example.com/pricing"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
