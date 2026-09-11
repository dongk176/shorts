import sharp from "sharp";
import { HttpError } from "@/lib/http";

export async function readCreatorJson(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HttpError(413, "파일 또는 입력 내용이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "입력 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "파일 또는 입력 내용이 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function prepareCreatorImage(base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new HttpError(400, "이미지 파일을 다시 선택해 주세요.");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new HttpError(413, "이미지는 2MB 이하로 선택해 주세요.");
  try {
    const source = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const metadata = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) {
      throw new Error("Unsupported image");
    }
    const image = await source.rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (image.length > 262144) throw new Error("Image too large");
    return image;
  } catch { throw new HttpError(400, "JPG, PNG, WEBP 정지 이미지를 선택해 주세요."); }
}
