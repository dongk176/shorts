import { HttpError } from "@/lib/http";
import { requestAppOrigin } from "@/lib/auth";

export function assertSameOriginJsonRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpError(403, "요청 출처를 확인할 수 없습니다.", "ORIGIN_REQUIRED");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, "요청 출처가 올바르지 않습니다.", "INVALID_ORIGIN");
  }
  const expected = new URL(requestAppOrigin(request));
  if (parsedOrigin.protocol !== expected.protocol || parsedOrigin.host !== expected.host) {
    throw new HttpError(403, "다른 출처에서 보낸 요청은 차단됩니다.", "CROSS_ORIGIN_REQUEST");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new HttpError(403, "동일 출처 요청만 허용됩니다.", "CROSS_SITE_REQUEST");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "JSON 형식의 요청만 허용됩니다.", "JSON_REQUIRED");
  }
}
