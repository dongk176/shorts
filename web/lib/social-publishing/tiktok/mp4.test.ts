import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { probeMp4 } from "./mp4";
let root: string;
beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), "tiktok-mp4-probe-")); });
afterAll(() => rmSync(root, { recursive: true, force: true }));
describe("hosted MP4 inspection using actual finished bytes", () => {
  for (const faststart of [true, false]) it(`matches ffprobe with moov ${faststart ? "before" : "after"} media data`, async () => {
    const file = path.join(root, `${faststart}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(faststart ? ["-movflags", "+faststart"] : []), file], { timeout: 30000 });
    const bytes = readFileSync(file), ranges: number[] = [];
    const metadata = await probeMp4(bytes.length, async (start, end) => { ranges.push(end - start + 1); return bytes.subarray(start, end + 1); });
    const ffprobe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration,r_frame_rate", "-of", "json", file], { timeout: 10000, encoding: "utf8" }));
    expect(metadata).toMatchObject({ width: 360, height: 640, fps: 30, codec: "avc1" });
    expect(metadata.duration).toBeCloseTo(Number(ffprobe.streams[0].duration), 4);
    expect(ranges.reduce((a, b) => a + b, 0)).toBeLessThan(bytes.length / 2);
  });
  it("rejects corrupt/oversized metadata without fetching the file body", async () => {
    await expect(probeMp4(100, async () => Buffer.alloc(16))).rejects.toThrow();
    const header = Buffer.alloc(16); header.writeUInt32BE(9000000); header.write("moov", 4);
    let calls = 0;
    await expect(probeMp4(10000000, async () => { calls++; return header; })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
