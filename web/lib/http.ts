import { NextResponse } from "next/server";

export function apiError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  const status = /찾을 수 없|접근/.test(message) ? 404 : /설정되지|완료되지/.test(message) ? 503 : 400;
  return NextResponse.json({ detail: message }, { status });
}
