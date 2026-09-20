import "server-only";
import { createHash } from "node:crypto";
import { getShortPlaybackAccess } from "@/lib/aws";
import { HttpError } from "@/lib/http";
import { probeMp4 } from "./mp4";

export type MediaFile = { file: string; size: number; etag?: string };
export interface TikTokMediaAccess {
  file(key: string): Promise<MediaFile>;
  fingerprint(key: string): Promise<string>;
  inspect(key: string): Promise<MediaFile & { duration: number; hash: string }>;
}
const unavailable = () => new HttpError(404, "The finished video is unavailable.", "TIKTOK_MEDIA_UNAVAILABLE");
const validKey = (key: string) => /^outputs\/[A-Za-z0-9/_-]+\.mp4$/.test(key) && !key.includes("..");
async function signedUrl(key: string) {
  if (!validKey(key)) throw unavailable();
  return (await getShortPlaybackAccess({ outputKey: key, thumbnailKey: null, expiresAt: new Date(Date.now() + 5 * 60_000) })).url;
}
async function request(key: string, init: RequestInit) {
  const url = await signedUrl(key);
  return fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000) });
}
function fingerprint(source: MediaFile) {
  return createHash("sha256").update(JSON.stringify([source.file, source.etag, source.size])).digest("hex");
}
export class TikTokMedia implements TikTokMediaAccess {
  async file(key: string): Promise<MediaFile> {
    const response = await request(key, { method: "HEAD" });
    const size = Number(response.headers.get("content-length")), etag = response.headers.get("etag");
    if (!response.ok || !Number.isSafeInteger(size) || size < 12 || size > 250 * 1024 * 1024 || !etag) throw unavailable();
    return { file: key, size, etag };
  }
  async fingerprint(key: string) { return fingerprint(await this.file(key)); }
  async inspect(key: string) {
    const source = await this.file(key);
    try {
      const metadata = await probeMp4(source.size, async (start, end) => {
        const response = await request(key, { headers: { Range: `bytes=${start}-${end}`, "If-Match": source.etag!, "Accept-Encoding": "identity" } });
        if (response.status !== 206 || response.headers.get("etag") !== source.etag
          || response.headers.get("content-range") !== `bytes ${start}-${end}/${source.size}`) { await response.body?.cancel(); throw unavailable(); }
        if (Number(response.headers.get("content-length")) !== end - start + 1) { await response.body?.cancel(); throw unavailable(); }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw unavailable();
        return bytes;
      });
      return { ...source, duration: metadata.duration, hash: fingerprint(source) };
    } catch { throw new HttpError(400, "The video does not meet TikTok's format requirements.", "TIKTOK_MEDIA_UNAVAILABLE"); }
  }
}

// TikTok must receive bytes from the verified EasyCut origin, not a redirect.
// Only the expiring capability handler or authenticated owner can call this.
export async function mediaResponse(incoming: Request, source: MediaFile) {
  const range = incoming.headers.get("range");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response(null, { status: 416 });
  const response = await request(source.file, {
    method: incoming.method === "HEAD" ? "HEAD" : "GET",
    headers: { ...(range ? { Range: range } : {}), ...(source.etag ? { "If-Match": source.etag } : {}), "Accept-Encoding": "identity" },
  });
  if (![200, 206].includes(response.status) || response.headers.get("etag") !== source.etag) { await response.body?.cancel(); throw unavailable(); }
  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name); if (value) headers.set(name, value);
  }
  return new Response(incoming.method === "HEAD" ? null : response.body, { status: response.status, headers });
}
