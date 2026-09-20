import "server-only";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/http";
const run = promisify(execFile);

export class TikTokMedia {
  constructor(private root: string, private probe = "ffprobe") {}
  async file(key: string) {
    if (!/^outputs\/[a-zA-Z0-9/_-]+\.mp4$/.test(key) || key.includes("..")) throw new HttpError(400, "Invalid finished video.", "TIKTOK_MEDIA_UNAVAILABLE");
    const root = await fs.realpath(this.root), file = await fs.realpath(path.join(root, key));
    if (!file.startsWith(root+path.sep)) throw new HttpError(400, "Invalid media path.", "TIKTOK_MEDIA_UNAVAILABLE");
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size < 12 || stat.size > 250*1024*1024) throw new HttpError(400, "Choose a finished MP4 under 250 MB.", "TIKTOK_MEDIA_UNAVAILABLE");
    return { file, size: stat.size };
  }
  async fingerprint(file: string) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest("hex");
  }
  async inspect(key: string) {
    const source = await this.file(key);
    const { stdout } = await run(this.probe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", source.file], { timeout: 10_000, maxBuffer: 1024*1024 });
    const info = JSON.parse(stdout), duration = Number(info.format?.duration);
    const video = info.streams?.find((stream: { codec_type?: string }) => stream.codec_type === "video");
    const [numerator, denominator] = String(video?.r_frame_rate).split("/").map(Number), fps = numerator/denominator;
    if (!Number.isFinite(duration) || duration < 3 || !video || !["h264", "hevc", "vp8", "vp9"].includes(video.codec_name) || video.width < 360 || video.height < 360 || video.width > 4096 || video.height > 4096 || !Number.isFinite(fps) || fps < 23 || fps > 60) {
      throw new HttpError(400, "The video does not meet TikTok's format requirements.", "TIKTOK_MEDIA_UNAVAILABLE");
    }
    return { ...source, duration, hash: await this.fingerprint(source.file) };
  }
}
