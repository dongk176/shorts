import { NextResponse } from "next/server";

export class HttpError extends Error {
  public readonly code: string;

  constructor(public readonly status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.code = code || `HTTP_${status}`;
  }
}

export function apiError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  const errorCode = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : null;
  const explicitStatus = error instanceof HttpError
    ? error.status
    : typeof (error as { status?: unknown })?.status === "number"
      ? Math.max(400, Math.min(599, Number((error as { status: number }).status)))
      : null;
  const status = explicitStatus !== null
    ? explicitStatus
    : errorCode === "57014" || /timeout|시간 초과/i.test(message)
      ? 503
      : /찾을 수 없|접근/.test(message)
        ? 404
        : /설정되지|완료되지|일시적으로 제한/.test(message)
          ? 503
          : 400;
  const responseCode = error instanceof HttpError
    ? error.code
    : errorCode && /^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode)
      ? errorCode
      : `HTTP_${status}`;
  const response = NextResponse.json({ detail: message, code: responseCode }, { status });
  if (status === 503) response.headers.set("Retry-After", "2");
  return response;
}
