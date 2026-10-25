import "server-only";
import { getDb } from "./db";
import { HttpError } from "./http";
export async function leaseRankingVercelRoute(operation: string, task: string) {
  const raw = process.env.RANKING_PROXY_ROUTES_JSON;
  if (!raw) throw new HttpError(503, "유튜브 다운로드 경로를 준비 중입니다.");
  const routes = JSON.parse(raw) as {
    id: string;
    proxy_url: string;
    egress_class: string;
  }[];
  const allowed = routes.filter(
    (r) =>
      r.egress_class === "webshare_isp" &&
      /^[a-z0-9][a-z0-9_-]{0,31}$/.test(r.id),
  );
  if (!allowed.length || allowed.length > 32)
    throw new HttpError(503, "다운로드 경로 설정을 확인해 주세요.");
  const db = getDb();
  const previous =
    await db`select route_id from shorts_mvp.ranking_route_attempts where operation_id=${operation}`;
  const held =
    await db`select route_id from shorts_mvp.ingestion_route_slots where ranking_operation_id=${operation} and ranking_lease_expires_at>now()`;
  const row =
    held[0] ||
    (
      await db`select shorts_ranking_runtime.claim_route_parallel(${operation}::uuid,${task},${allowed.map((r) => r.id)}::text[],${previous.map((r) => r.routeId)}::text[]) as route_id`
    )[0];
  const match = allowed.find((r) => r.id === row?.routeId);
  return match ? match.proxy_url : null;
}
export async function releaseRankingVercelRoutes(
  operation: string,
  task: string,
  result: "success" | "bot_check" | "network_error" | "terminal",
) {
  const db = getDb();
  const held =
    await db`select route_id from shorts_mvp.ingestion_route_slots where ranking_operation_id=${operation}`;
  for (const route of held)
    await db`select shorts_ranking_runtime.release_route(${operation}::uuid,${task},${route.routeId},${result})`;
}
