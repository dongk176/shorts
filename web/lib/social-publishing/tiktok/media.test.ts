import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const signer = vi.hoisted(() => vi.fn(async () => ({ url: "https://media.example.test/private?signature=secret" })));
vi.mock("@/lib/aws", () => ({ getShortPlaybackAccess: signer }));
import { mediaResponse, TikTokMedia } from "./media";
const fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); signer.mockClear(); });
describe("hosted TikTok media boundary", () => {
  it("rejects unsafe keys before signing or accessing storage", async () => {
    for (const key of ["https://example.com/video.mp4", "outputs/../secret.mp4", "/outputs/video.mp4", "inputs/video.mp4"])
      await expect(new TikTokMedia().file(key)).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a bounded size and immutable object identity", async () => {
    for (const headers of ([{ "content-length": "300000000", etag: '"v1"' }, { "content-length": "100" }, { "content-length": "0", etag: '"v1"' }] as Record<string, string>[])) {
      fetcher.mockResolvedValueOnce(new Response(null, { headers }));
      await expect(new TikTokMedia().file("outputs/a.mp4")).rejects.toThrow();
    }
  });
  it("rejects range responses from a changed source", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { headers: { "content-length": "100", etag: '"v1"' } }));
    fetcher.mockResolvedValueOnce(new Response(Buffer.alloc(16), { status: 206, headers: { "content-length": "16", "content-range": "bytes 0-15/100", etag: '"v2"' } }));
    await expect(new TikTokMedia().inspect("outputs/a.mp4")).rejects.toThrow();
    expect(fetcher.mock.calls[1][1].headers["If-Match"]).toBe('"v1"');
  });
  it("streams a single range without exposing or redirecting to signed URLs", async () => {
    fetcher.mockResolvedValueOnce(new Response("abcd", { status: 206, headers: { "content-length": "4", "content-range": "bytes 0-3/100", etag: '"v1"' } }));
    const response = await mediaResponse(new Request("https://www.easycut.co.kr/api/social/tiktok/media/capability", { headers: { range: "bytes=0-3" } }), { file: "outputs/a.mp4", size: 100, etag: '"v1"' });
    expect(response.status).toBe(206); expect(await response.text()).toBe("abcd");
    expect(response.headers.get("location")).toBeNull(); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { Range: "bytes=0-3", "If-Match": '"v1"' } });
  });
  it("rejects multi-range requests and changed media", async () => {
    expect((await mediaResponse(new Request("https://example.test", { headers: { range: "bytes=0-3,9-12" } }), { file: "outputs/a.mp4", size: 100, etag: '"v1"' })).status).toBe(416);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response("changed", { headers: { etag: '"v2"' } }));
    await expect(mediaResponse(new Request("https://example.test"), { file: "outputs/a.mp4", size: 100, etag: '"v1"' })).rejects.toThrow();
  });
});
