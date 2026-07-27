import { NextResponse } from "next/server";
import { z } from "zod";
import { userFacingErrorMessage } from "@/lib/public-error";

export class HttpError extends Error {
  public readonly code: string;

  constructor(
    public readonly status: number,
    message: string,
    code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code || `HTTP_${status}`;
  }
}

export function apiError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const isValidationError = error instanceof z.ZodError;
  const isMalformedJson = error instanceof SyntaxError;
  const message = error instanceof HttpError
    ? error.message
    : isValidationError
      ? "입력한 내용을 다시 확인해 주세요."
      : isMalformedJson
        ? "요청 형식이 올바르지 않습니다."
        : userFacingErrorMessage(rawMessage, fallback);
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
    : errorCode === "57014" || /timeout|시간 초과/i.test(rawMessage)
      ? 503
      : /찾을 수 없|접근/.test(rawMessage)
        ? 404
        : /설정되지|완료되지|일시적으로 제한/.test(rawMessage)
          ? 503
          : 400;
  const responseCode = error instanceof HttpError
    ? error.code
    : isValidationError
      ? "INVALID_INPUT"
      : isMalformedJson
        ? "INVALID_REQUEST_BODY"
        : errorCode && /^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode)
          ? errorCode
          : `HTTP_${status}`;
  const response = NextResponse.json({ detail: message, code: responseCode }, { status });
  if (error instanceof HttpError && error.retryAfterSeconds) {
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
  } else if (status === 503) {
    response.headers.set("Retry-After", "2");
  }
  return response;
}
