import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
vi.mock("server-only", () => ({}));
import { tiktokConfig } from "./config";
import { TikTokMedia } from "@/test-tools/tiktok-local-media";
import { tiktokText, tiktokError } from "./i18n";

const env = { NODE_ENV: "test", TIKTOK_PUBLISHING_MODE: "local", DATABASE_URL: "postgres://test@localhost:55439/review", TIKTOK_ALLOWED_USER_IDS: "11111111-1111-4111-8111-111111111111" } as const;
describe("TikTok local environment boundaries", () => {
  it("requires explicit local mode, a local DB and allowlisted user IDs", () => {
    expect(tiktokConfig(env).oauthReady).toBe(false);
    for (const change of [{ NODE_ENV: "production" }, { VERCEL_ENV: "preview" }, { DATABASE_URL: "postgres://test@db.example.com/prod" }, { TIKTOK_PUBLISHING_MODE: "" }, { TIKTOK_ALLOWED_USER_IDS: "*" }] as const) expect(() => tiktokConfig({ ...env, ...change })).toThrow();
  });
  it("requires exact public HTTPS origin and stays private regardless of flags", () => {
    for (const origin of ["http://localhost:3002", "https://user:password@example.com", "https://example.com/path", "https://example.com?x=1", "https://127.0.0.1", "https://evil.local"]) expect(() => tiktokConfig({ ...env, TIKTOK_PUBLIC_ORIGIN: origin })).toThrow();
    const config = tiktokConfig({ ...env, TIKTOK_PUBLIC_ORIGIN: "https://review.example.com", TIKTOK_CLIENT_KEY: "test", TIKTOK_CLIENT_SECRET: "test", TIKTOK_ALLOW_PUBLIC: "true" });
    expect(config.redirectUri).toBe("https://review.example.com/api/social/tiktok/oauth/callback");
    expect(config.auditApproved).toBe(false); expect(config.oauthReady).toBe(true); expect(config.mediaVerified).toBe(false);
  });
  it("localizes actionable errors and never reflects unknown provider messages", () => {
    expect(tiktokText("ko")("connect")).toContain("연결");
    for (const locale of ["en", "ja"]) {
      expect(tiktokText(locale)("setup")).not.toMatch(/[가-힣]/);
      expect(tiktokError("private access_token=secret", locale)).not.toMatch(/access_token|secret|private/);
      expect(tiktokError("TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS", locale)).toBe(tiktokText(locale)("privateAccountRequired"));
    }
  });
});

describe("TikTok actual FFmpeg/ffprobe media checks", () => {
  let root: string, media: TikTokMedia;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-media-")); fs.mkdirSync(path.join(root, "outputs"));
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=360x640:r=30:d=3.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(root, "outputs/video.mp4")], { timeout: 30_000, stdio: "pipe" });
    media = new TikTokMedia(root);
  }, 35_000);
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
  it("probes the finished bytes and computes a stable fingerprint", async () => {
    const result = await media.inspect("outputs/video.mp4");
    expect(result.duration).toBeGreaterThanOrEqual(3); expect(result.duration).toBeLessThan(4);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/); expect(result.size).toBeGreaterThan(12);
  });
  it("rejects traversal, external URLs, symlink escapes and invalid media", async () => {
    for (const key of ["../outside.mp4", "outputs/../outside.mp4", "https://example.com/file.mp4", "outputs/a;echo.mp4"]) await expect(media.file(key)).rejects.toThrow();
    fs.symlinkSync("/etc/hosts", path.join(root, "outputs/escape.mp4")); await expect(media.file("outputs/escape.mp4")).rejects.toThrow();
    fs.writeFileSync(path.join(root, "outputs/invalid.mp4"), Buffer.alloc(64)); await expect(media.inspect("outputs/invalid.mp4")).rejects.toThrow();
  });
});
