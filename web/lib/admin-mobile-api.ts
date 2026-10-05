import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { apiError, HttpError } from "@/lib/http";

export async function authorizeMobile(request?: Request) {
  const admin = await requireAdminUser();
  if (process.env.ADMIN_MOBILE_ENABLED !== "1") throw new HttpError(503, "관리자 앱 연결을 준비하고 있어요.");
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "요청 출처를 확인해주세요.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "JSON 요청이 필요합니다.");
  }
  return admin;
}
export async function mobileBody(request: Request) {
  const body = await request.text();
  if (body.length > 8192) throw new HttpError(413, "요청이 너무 큽니다.");
  return JSON.parse(body);
}
export function mobileJSON(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
}
export function mobileError(error: unknown) {
  const response = apiError(error, "운영 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
export function authorizedMobileCron(request: Request) {
  const expected = process.env.CRON_SECRET || "";
  const actual = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return Boolean(expected && actual && a.length === b.length && timingSafeEqual(a, b));
}
