import "server-only";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

export function rankingEnabled() {
  return process.env.RANKING_SHORTS_ENABLED === "1";
}
export function rankingUuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(404, "찾을 수 없습니다.");
  return value;
}
export function requireRankingOrigin(request: Request) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    !origin ||
    origin !== new URL(request.url).origin
  ) {
    throw new HttpError(403, "요청 출처를 확인해 주세요.");
  }
}
export async function requireRankingUser(request?: Request) {
  if (!rankingEnabled()) throw new HttpError(404, "찾을 수 없습니다.");
  const auth = await getAuthenticatedUser();
  if (!auth || auth.is_anonymous) throw new HttpError(401, "로그인이 필요합니다.");
  if (request) requireRankingOrigin(request);
  const rows = await getDb()`select id,auth_user_id,email,display_name from shorts_mvp.app_users where auth_user_id=${auth.id} limit 1`;
  if (!rows[0]) throw new HttpError(403, "계정 정보를 확인해 주세요. 다시 로그인해 주세요.");
  return { id: rows[0].id as string, authUserId: auth.id, email: String(rows[0].email || auth.email || ""), displayName: rows[0].displayName || null };
}
export async function requireRankingProject(id: string, userId: string) {
  rankingUuid(id);
  const rows =
    await getDb()`select id, user_id, draft, expires_at from shorts_mvp.ranking_projects
    where id=${id} and user_id=${userId} and deleted_at is null and expires_at>now()`;
  if (!rows[0])
    throw new HttpError(404, "작업이 없거나 보관 기간이 끝났습니다.");
  return rows[0];
}
export function rankingError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
    },
    {
      status: error instanceof HttpError ? error.status : 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
export function rankingReply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function rankingBody(request: Request) {
  if (!request.body) throw new HttpError(400, "입력 내용을 확인해 주세요.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new HttpError(413, "입력 내용이 너무 깁니다.");
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new HttpError(400, "입력 형식을 확인해 주세요.");
    }
  } finally {
    reader.releaseLock();
  }
}
