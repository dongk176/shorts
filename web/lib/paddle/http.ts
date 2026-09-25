import { NextResponse } from "next/server";
import { HttpError } from "@/lib/http";
import { z } from "zod";
export function paddleJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function paddleError(error: unknown) {
  const status =
    error instanceof HttpError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 503;
  return paddleJson(
    {
      code:
        error instanceof HttpError
          ? error.code
          : status === 400
            ? "INVALID_REQUEST"
            : "PADDLE_UNAVAILABLE",
    },
    status,
  );
}
