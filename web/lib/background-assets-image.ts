import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  BACKGROUND_ASSET_HEIGHT,
  BACKGROUND_ASSET_MAX_INPUT_BYTES,
  BACKGROUND_ASSET_MAX_INPUT_PIXELS,
  BACKGROUND_ASSET_MAX_OUTPUT_BYTES,
  BACKGROUND_ASSET_WIDTH,
} from "@/lib/background-assets-contract";
import { HttpError } from "@/lib/http";

export type NormalizedBackgroundAssetImage = {
  body: Buffer;
  sha256: string;
  byteSize: number;
  originalByteSize: number;
  width: typeof BACKGROUND_ASSET_WIDTH;
  height: typeof BACKGROUND_ASSET_HEIGHT;
};

function invalidImage() {
  return new HttpError(400, "이미지를 읽을 수 없습니다. 정상적인 JPG, PNG 또는 정지 WebP를 선택해 주세요.", "BACKGROUND_IMAGE_INVALID");
}

function animatedImage(): never {
  throw new HttpError(400, "움직이는 이미지는 배경으로 사용할 수 없습니다.", "BACKGROUND_IMAGE_ANIMATED");
}

function inspectContainer(body: Buffer): "jpeg" | "png" | "webp" {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "jpeg";
  }
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    let offset = 8;
    let ended = false;
    while (offset + 12 <= body.length) {
      const length = body.readUInt32BE(offset);
      if (length > body.length - offset - 12) throw invalidImage();
      const name = body.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(name)) animatedImage();
      offset += length + 12;
      if (name === "IEND") { ended = true; break; }
    }
    if (!ended || offset !== body.length) throw invalidImage();
    return "png";
  }
  if (body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF"
    && body.toString("ascii", 8, 12) === "WEBP") {
    if (body.readUInt32LE(4) + 8 !== body.length) throw invalidImage();
    let offset = 12;
    while (offset + 8 <= body.length) {
      const length = body.readUInt32LE(offset + 4);
      if (length > body.length - offset - 8) throw invalidImage();
      const name = body.toString("ascii", offset, offset + 4);
      if (name === "ANIM" || name === "ANMF"
        || (name === "VP8X" && length > 0 && (body[offset + 8] & 0x02) !== 0)) animatedImage();
      offset += 8 + length + (length % 2);
    }
    if (offset !== body.length) throw invalidImage();
    return "webp";
  }
  throw new HttpError(415, "JPG, PNG 또는 정지 WebP 이미지만 사용할 수 있습니다.", "BACKGROUND_IMAGE_TYPE_UNSUPPORTED");
}

export async function normalizeBackgroundAssetImage(
  body: Buffer,
  input: { filename: string; contentType: string },
): Promise<NormalizedBackgroundAssetImage> {
  if (body.length === 0 || body.length > BACKGROUND_ASSET_MAX_INPUT_BYTES) {
    throw new HttpError(413, "배경 이미지는 3MB 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_LARGE");
  }
  const format = inspectContainer(body);
  const extension = /\.([^.\\/]+)$/.exec(input.filename)?.[1]?.toLowerCase();
  const expectedExtensions = format === "jpeg" ? ["jpg", "jpeg"] : [format];
  const contentType = input.contentType.trim().toLowerCase();
  if (!extension || !expectedExtensions.includes(extension)
    || (contentType !== "" && contentType !== `image/${format}`)) {
    throw new HttpError(415, "파일 이름과 실제 이미지 형식이 일치하지 않습니다.", "BACKGROUND_IMAGE_TYPE_MISMATCH");
  }
  try {
    const image = sharp(body, {
      failOn: "warning",
      limitInputPixels: BACKGROUND_ASSET_MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).timeout({ seconds: 8 });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) throw invalidImage();
    if ((metadata.pages ?? 1) !== 1 || (metadata.delay?.length ?? 0) > 1) animatedImage();
    if (metadata.width * metadata.height > BACKGROUND_ASSET_MAX_INPUT_PIXELS) {
      throw new HttpError(413, "배경 이미지는 2,000만 픽셀 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_MANY_PIXELS");
    }
    // No input metadata is copied: orientation is applied, ICC is converted,
    // and GPS/EXIF are stripped by sharp's default output behavior.
    const { data, info } = await image
      .autoOrient()
      .toColourspace("srgb")
      .flatten({ background: "#000000" })
      .resize(BACKGROUND_ASSET_WIDTH, BACKGROUND_ASSET_HEIGHT, { fit: "cover", position: "centre" })
      .webp({ quality: 85, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > BACKGROUND_ASSET_MAX_OUTPUT_BYTES) {
      throw new HttpError(413, "변환된 이미지가 너무 큽니다. 더 작은 이미지를 선택해 주세요.", "BACKGROUND_IMAGE_OUTPUT_TOO_LARGE");
    }
    if (info.width !== BACKGROUND_ASSET_WIDTH || info.height !== BACKGROUND_ASSET_HEIGHT) throw invalidImage();
    return {
      body: data,
      sha256: createHash("sha256").update(data).digest("hex"),
      byteSize: data.length,
      originalByteSize: body.length,
      width: BACKGROUND_ASSET_WIDTH,
      height: BACKGROUND_ASSET_HEIGHT,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new HttpError(413, "배경 이미지는 2,000만 픽셀 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_MANY_PIXELS");
    }
    throw invalidImage();
  }
}
