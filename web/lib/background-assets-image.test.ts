import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeBackgroundAssetImage } from "@/lib/background-assets-image";
import { BACKGROUND_ASSET_MAX_INPUT_BYTES, BACKGROUND_ASSET_MAX_OUTPUT_BYTES } from "@/lib/background-assets-contract";

function solid(width: number, height: number, background = "#ff0000") {
  return sharp({ create: { width, height, channels: 4, background } });
}

describe("private background normalization", () => {
  it.each([
    [400, 200, "jpeg"],
    [200, 400, "png"],
    [200, 200, "webp"],
  ] as const)("normalizes %sx%s %s to static 1080x1920 WebP", async (width, height, format) => {
    const body = await solid(width, height).toFormat(format).toBuffer();
    const output = await normalizeBackgroundAssetImage(body, {
      filename: `background.${format === "jpeg" ? "jpg" : format}`, contentType: `image/${format}`,
    });
    const metadata = await sharp(output.body).metadata();
    expect(metadata).toMatchObject({ width: 1080, height: 1920, format: "webp", hasAlpha: false });
    expect(metadata.exif).toBeUndefined();
    expect(output.byteSize).toBeLessThanOrEqual(BACKGROUND_ASSET_MAX_OUTPUT_BYTES);
    expect(output.sha256).toBe(createHash("sha256").update(output.body).digest("hex"));
    expect(output.originalByteSize).toBe(body.length);
  });

  it("centers cover cropping instead of stretching or letterboxing", async () => {
    const input = await solid(300, 100, "#00ff00").composite([
      { input: await solid(100, 100, "#ff0000").png().toBuffer(), left: 0, top: 0 },
      { input: await solid(100, 100, "#0000ff").png().toBuffer(), left: 200, top: 0 },
    ]).png().toBuffer();
    const output = await normalizeBackgroundAssetImage(input, { filename: "bands.png", contentType: "image/png" });
    const pixel = await sharp(output.body).extract({ left: 500, top: 500, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[1]).toBeGreaterThan(230);
    expect(pixel[0]).toBeLessThan(25);
    expect(pixel[2]).toBeLessThan(25);
  });

  it("flattens transparency against black", async () => {
    const body = await solid(20, 20, "#ff000000").png().toBuffer();
    const output = await normalizeBackgroundAssetImage(body, { filename: "transparent.png", contentType: "image/png" });
    const pixel = await sharp(output.body).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect([...pixel]).toEqual([0, 0, 0]);
  });

  it("applies EXIF orientation and removes metadata", async () => {
    const input = await solid(120, 60).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await normalizeBackgroundAssetImage(input, { filename: "rotated.jpg", contentType: "image/jpeg" });
    const metadata = await sharp(output.body).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    const alreadyOriented = await sharp(input).autoOrient().jpeg().toBuffer();
    const reference = await normalizeBackgroundAssetImage(alreadyOriented, { filename: "correct.jpg", contentType: "image/jpeg" });
    expect(output.sha256).toBe(reference.sha256);
  });

  it("produces a deterministic hash for repeat uploads", async () => {
    const body = await solid(100, 100).png().toBuffer();
    const first = await normalizeBackgroundAssetImage(body, { filename: "first.png", contentType: "image/png" });
    const second = await normalizeBackgroundAssetImage(body, { filename: "renamed.PNG", contentType: "image/png" });
    expect(first.sha256).toBe(second.sha256);
  });

  it.each([
    ["fake.jpg", "image/jpeg"],
    ["real.png", "image/webp"],
    ["fake.svg", "image/png"],
  ])("rejects disguised extension or MIME: %s %s", async (filename, contentType) => {
    const body = await solid(20, 20).png().toBuffer();
    await expect(normalizeBackgroundAssetImage(body, { filename, contentType }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_TYPE_MISMATCH" });
  });

  it("rejects GIF and nonimage inputs before decoding", async () => {
    await expect(normalizeBackgroundAssetImage(Buffer.from("GIF89a"), { filename: "animated.gif", contentType: "image/gif" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_TYPE_UNSUPPORTED" });
    await expect(normalizeBackgroundAssetImage(Buffer.from("<svg></svg>"), { filename: "fake.png", contentType: "image/png" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_TYPE_UNSUPPORTED" });
  });

  it("rejects damaged pixel data even when the signature is recognizable", async () => {
    const body = await solid(20, 20).jpeg().toBuffer();
    await expect(normalizeBackgroundAssetImage(body.subarray(0, 80), { filename: "damaged.jpg", contentType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_INVALID" });
    const png = await solid(20, 20).png().toBuffer();
    await expect(normalizeBackgroundAssetImage(png.subarray(0, png.length - 10), { filename: "damaged.png", contentType: "image/png" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_INVALID" });
  });

  it("rejects APNG control chunks even if a decoder would flatten the first frame", async () => {
    const png = await solid(20, 20).png().toBuffer();
    const animationControl = Buffer.alloc(20);
    animationControl.writeUInt32BE(8, 0);
    animationControl.write("acTL", 4, "ascii");
    animationControl.writeUInt32BE(2, 8);
    const body = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)]);
    await expect(normalizeBackgroundAssetImage(body, { filename: "animated.png", contentType: "image/png" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_ANIMATED" });
  });

  it("rejects WebP animation chunks before attempting to decode one frame", async () => {
    const body = Buffer.alloc(26);
    body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WEBPANIM", 8);
    body.writeUInt32LE(6, 16);
    await expect(normalizeBackgroundAssetImage(body, { filename: "animated.webp", contentType: "image/webp" }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_ANIMATED" });
  });

  it("rejects >3MiB input and >20million decoded pixels", async () => {
    await expect(normalizeBackgroundAssetImage(Buffer.alloc(BACKGROUND_ASSET_MAX_INPUT_BYTES + 1), {
      filename: "large.png", contentType: "image/png",
    })).rejects.toMatchObject({ status: 413, code: "BACKGROUND_IMAGE_TOO_LARGE" });
    const pixels = await solid(5000, 4001).png().toBuffer();
    expect(pixels.length).toBeLessThan(BACKGROUND_ASSET_MAX_INPUT_BYTES);
    await expect(normalizeBackgroundAssetImage(pixels, { filename: "pixels.png", contentType: "image/png" }))
      .rejects.toMatchObject({ status: 413, code: "BACKGROUND_IMAGE_TOO_MANY_PIXELS" });
  });
});
