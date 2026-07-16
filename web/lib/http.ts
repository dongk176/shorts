import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function apiError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  const errorCode = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : null;
  const status = error instanceof HttpError
    ? error.status
    : errorCode === "57014" || /timeout|시간 초과/i.test(message)
      ? 503
      : /찾을 수 없|접근/.test(message)
        ? 404
        : /설정되지|완료되지|일시적으로 제한/.test(message)
          ? 503
          : 400;
  const response = NextResponse.json({ detail: message }, { status });
  if (status === 503) response.headers.set("Retry-After", "2");
  return response;
}
