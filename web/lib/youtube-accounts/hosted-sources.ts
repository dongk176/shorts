import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getShortPlaybackAccess } from "@/lib/aws";
import { HttpError } from "@/lib/http";
import { TikTokMedia } from "@/lib/social-publishing/tiktok/media";

// One instance per authenticated request. Only finished, owner-checked output keys
// enter this provider. No remote token, URL or user filename becomes a disk path.
export class HostedYoutubeSources {
  private directory: string | undefined;
  private files = new Map<string, { file: string; size: number }>();
  constructor(private fetcher: typeof fetch = fetch) {}
  async preview(key: string) { return new TikTokMedia().file(key); }
  async file(key: string) {
    if (!/^outputs\/[A-Za-z0-9/_-]+\.mp4$/.test(key) || key.includes("..")) throw new HttpError(400, "Invalid finished video.");
    const cached = this.files.get(key);
    if (cached) return cached;
    const signed = await getShortPlaybackAccess({ outputKey: key, thumbnailKey: null, expiresAt: new Date(Date.now() + 120_000) });
    const response = await this.fetcher(signed.url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000), headers: { "Accept-Encoding": "identity" } });
    const size = Number(response.headers.get("content-length"));
    // Match the bounded finished-video limit used by the local upload path.
    const max = 250 * 1024 * 1024;
    if (!response.ok || !response.body || !Number.isSafeInteger(size) || size < 12 || size > max) {
      await response.body?.cancel(); throw new HttpError(400, "The finished video is unavailable or exceeds 250 MiB.");
    }
    if (!this.directory) this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "easycut-youtube-"));
    const file = path.join(this.directory, `${randomUUID()}.mp4`);
    const handle = await fs.open(file, "wx", 0o600);
    let received = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > size || received > max) throw new Error("Invalid source size");
        let offset = 0;
        while (offset < value.byteLength) offset += (await handle.write(value.subarray(offset))).bytesWritten;
      }
      if (received !== size) throw new Error("Incomplete source");
    } catch {
      await reader.cancel().catch(() => {});
      await handle.close(); await fs.rm(file, { force: true });
      throw new HttpError(502, "The finished video could not be retrieved.");
    } finally { await handle.close(); reader.releaseLock(); }
    const result = { file, size };
    this.files.set(key, result);
    return result;
  }
  async cleanup() {
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    this.files.clear(); this.directory = undefined;
  }
}
