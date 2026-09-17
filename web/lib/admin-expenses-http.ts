import { HttpError, apiError } from "@/lib/http";
export const expensePrivateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export async function expenseRequestBody(request: Request) {
  const max = 3_000_000;
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, "증빙 파일의 총용량을 줄여 주세요.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "입력 내용을 확인해 주세요.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new HttpError(413, "증빙 파일의 총용량을 줄여 주세요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function expenseApiError(error: unknown) {
  const response = apiError(error, "비용 장부를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  for (const [key,value] of Object.entries(expensePrivateHeaders)) response.headers.set(key,value);
  return response;
}
