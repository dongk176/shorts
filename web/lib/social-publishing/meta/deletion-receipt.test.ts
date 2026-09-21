import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const store = { deauthorized: vi.fn(), hasDeletionReceipt: vi.fn() };
const origin = "https://www.easycut.co.kr";
vi.mock("./runtime", () => ({ metaServices: (platform: string) => ({ store, config: {
  platform, origin, appKey: `${platform}:123`, clientSecret: `test-${platform}-secret`,
} }) }));
import { deauthorizePost, deletionStatusGet } from "./handlers";
const context = { params: Promise.resolve({ platform: "threads" }) };
function request(secret = "test-threads-secret", issuedAt = Math.floor(Date.now()/1000)) {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "123456789", issued_at: issuedAt })).toString("base64url");
  const signed = `${createHmac("sha256", secret).update(payload).digest("base64url")}.${payload}`;
  return new Request(`${origin}/api/social/threads/deauthorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: signed }) });
}
beforeEach(() => { vi.resetAllMocks(); store.deauthorized.mockResolvedValue(undefined); store.hasDeletionReceipt.mockResolvedValue(true); });
describe("Meta deletion acknowledgements", () => {
  it("returns a verifiable, anonymous completion page only after deletion commits", async () => {
    const result = await deauthorizePost(request(), context);
    expect(result.status).toBe(200);
    const receipt = await result.json();
    expect(receipt.confirmation_code).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(receipt.url).origin).toBe(origin);
    expect(store.deauthorized).toHaveBeenCalledWith("123456789", expect.any(Number), receipt.confirmation_code);
    const page = await deletionStatusGet(new Request(receipt.url), context);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Cache-Control")).toBe("private, no-store");
    expect(page.headers.get("X-Robots-Tag")).toContain("noindex");
    const html = await page.text();
    expect(html).toContain("Data deletion complete");
    expect(html).not.toContain("123456789");
    expect(JSON.stringify(receipt)).not.toContain("test-threads-secret");
  });
  it("never acknowledges a deletion that did not commit", async () => {
    store.deauthorized.mockRejectedValueOnce(new Error("private database details"));
    const result = await deauthorizePost(request(), context);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toMatch(/confirmation_code|private database/);
  });
  it("rejects forged and expired requests before deletion", async () => {
    expect((await deauthorizePost(request("wrong-secret"), context)).status).toBe(403);
    expect((await deauthorizePost(request(undefined, Math.floor(Date.now()/1000)-91*86400), context)).status).toBe(400);
    expect(store.deauthorized).not.toHaveBeenCalled();
  });
  it("rejects tampered and cross-platform status links before reading storage", async () => {
    const receipt = await (await deauthorizePost(request(), context)).json();
    const changed = new URL(receipt.url); changed.searchParams.set("proof", "0".repeat(64));
    expect((await deletionStatusGet(new Request(changed), context)).status).toBe(404);
    expect((await deletionStatusGet(new Request(receipt.url.replace("/threads/", "/instagram/")), { params: Promise.resolve({ platform: "instagram" }) })).status).toBe(404);
    expect(store.hasDeletionReceipt).not.toHaveBeenCalled();
  });
  it("does not claim completion for a missing or expired receipt", async () => {
    const receipt = await (await deauthorizePost(request(), context)).json();
    store.hasDeletionReceipt.mockResolvedValueOnce(false);
    expect((await deletionStatusGet(new Request(receipt.url), context)).status).toBe(404);
    expect((await deletionStatusGet(new Request(origin+"/api/social/threads/deauthorize"), context)).status).toBe(404);
  });
});
