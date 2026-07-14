import { describe, expect, it } from "vitest";
import { OAUTH_NEXT_COOKIE, requestAppOrigin, safeNextPath } from "./auth";

describe("OAuth redirect path", () => {
  it("allows only application-relative paths", () => {
    expect(safeNextPath("/pricing?cycle=yearly")).toBe("/pricing?cycle=yearly");
    expect(safeNextPath("https://attacker.example")).toBe("/");
    expect(safeNextPath("//attacker.example/path")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it("uses a dedicated short-lived cookie name for the OAuth return path", () => {
    expect(OAUTH_NEXT_COOKIE).toBe("easy_cut_oauth_next");
  });

  it("uses the browser localhost Host instead of the 0.0.0.0 dev bind address", () => {
    const request = new Request("http://0.0.0.0:3000/auth/sign-in", {
      headers: { Host: "localhost:3000", "X-Forwarded-Proto": "http" },
    });
    expect(requestAppOrigin(request)).toBe("http://localhost:3000");
  });

  it("does not trust a non-local Host over the normalized request origin", () => {
    const request = new Request("https://shorts.example/auth/sign-in", {
      headers: { Host: "attacker.example" },
    });
    expect(requestAppOrigin(request)).toBe("https://shorts.example");
  });
});
