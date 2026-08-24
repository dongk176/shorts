import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/locale", () => {
  it("stores a supported locale for one year", async () => {
    const response = await POST(new Request("http://localhost/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "ja" }),
    }));

    expect(response.status).toBe(204);
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("easycut_locale=ja");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=31536000");
  });

  it("rejects unsupported and malformed locale values", async () => {
    const unsupported = await POST(new Request("http://localhost/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "fr" }),
    }));
    const malformed = await POST(new Request("http://localhost/api/locale", {
      method: "POST",
      body: "not-json",
    }));

    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ code: "INVALID_LOCALE" });
    expect(malformed.status).toBe(400);
  });
});
