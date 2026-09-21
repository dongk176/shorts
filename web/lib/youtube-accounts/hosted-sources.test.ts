import fs from "node:fs/promises";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/aws", () => ({ getShortPlaybackAccess: vi.fn(async () => ({ url: "https://media.example/owned-output" })) }));
import { HostedYoutubeSources } from "./hosted-sources";
it("downloads bounded finished bytes with a server filename and always cleans the temp directory", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array(64), { headers: { "Content-Length": "64" } }));
  const sources = new HostedYoutubeSources(fetcher);
  const source = await sources.file("outputs/owned/video.mp4");
  expect((await fs.stat(source.file)).size).toBe(64);
  expect(source.file).not.toContain("owned");
  expect(await sources.file("outputs/owned/video.mp4")).toEqual(source); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toBeDefined();
  await sources.cleanup(); await expect(fs.stat(source.file)).rejects.toThrow();
});
it("rejects traversal before fetching and rejects oversized or partial streams", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array(12), { headers: { "Content-Length": "30" } }));
  const sources = new HostedYoutubeSources(fetcher);
  for (const key of ["outputs/../video.mp4","https://example.com/video.mp4","edit-sources/video.mp4"]) await expect(sources.file(key)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(sources.file("outputs/video.mp4")).rejects.toThrow();
  await sources.cleanup();
  const oversized = new HostedYoutubeSources(async () => new Response("x",{headers:{"Content-Length":String(26*1024*1024)}}));
  await expect(oversized.file("outputs/video.mp4")).rejects.toThrow(); await oversized.cleanup();
});
