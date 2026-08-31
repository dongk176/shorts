import "server-only";

import { requestAppOrigin } from "@/lib/auth";
import { BACKGROUND_ASSET_MAX_INPUT_BYTES } from "@/lib/background-assets-contract";
import { HttpError } from "@/lib/http";

export const BACKGROUND_ASSET_MULTIPART_MAX_BYTES = BACKGROUND_ASSET_MAX_INPUT_BYTES + 64 * 1024;

export function assertBackgroundAssetMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpError(403, "요청 출처를 확인할 수 없습니다.", "ORIGIN_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(origin); } catch {
    throw new HttpError(403, "요청 출처가 올바르지 않습니다.", "INVALID_ORIGIN");
  }
  const expected = new URL(requestAppOrigin(request));
  if (parsed.origin !== expected.origin || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash
    || !["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(403, "다른 출처에서 보낸 요청은 차단됩니다.", "CROSS_ORIGIN_REQUEST");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new HttpError(403, "동일 출처 요청만 허용됩니다.", "CROSS_SITE_REQUEST");
  }
}

export async function readBackgroundAssetUpload(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new HttpError(415, "이미지 파일 업로드 형식이 올바르지 않습니다.", "BACKGROUND_UPLOAD_MULTIPART_REQUIRED");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength)
    || Number(declaredLength) > BACKGROUND_ASSET_MULTIPART_MAX_BYTES)) {
    throw new HttpError(413, "배경 이미지는 3MB 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_LARGE");
  }
  if (!request.body) throw new HttpError(400, "이미지 파일을 선택해 주세요.", "BACKGROUND_FILE_REQUIRED");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BACKGROUND_ASSET_MULTIPART_MAX_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "배경 이미지는 3MB 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_LARGE");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    const body = Buffer.concat(parts);
    form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "이미지 파일 업로드 요청을 읽을 수 없습니다.", "BACKGROUND_UPLOAD_INVALID");
  }
  const entries = [...form.entries()];
  const file = form.get("file");
  if (entries.length !== 1 || entries[0][0] !== "file" || !file || typeof file === "string") {
    throw new HttpError(400, "배경 이미지 한 개만 선택해 주세요.", "BACKGROUND_FILE_REQUIRED");
  }
  if (file.size === 0 || file.size > BACKGROUND_ASSET_MAX_INPUT_BYTES) {
    throw new HttpError(413, "배경 이미지는 3MB 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_LARGE");
  }
  return file;
}
