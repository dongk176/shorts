import "server-only";
import { getDb } from "./db";
import { HttpError } from "./http";
import { createHash } from "node:crypto";
import { currentRankingProxyRegistry } from "./ranking-proxy-registry";
export async function leaseRankingVercelRoute(operation: string, task: string) {
  const { routes, registryVersion } = await currentRankingProxyRegistry();
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
      await db`select shorts_ranking_runtime.claim_route_beta(${operation}::uuid,${task},${allowed.map((r) => r.id)}::text[],${previous.map((r) => r.routeId)}::text[]) as route_id`
    )[0];
  const match = allowed.find((r) => r.id === row?.routeId);
  if (match) {
    const url = new URL(match.proxy_url);
    const endpointFingerprint = createHash("sha256").update(`${url.hostname}:${url.port}`).digest("hex").slice(0,16);
    await db`update shorts_mvp.ranking_operations set payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{egress}',${db.json({routeId:match.id,registryVersion,endpointFingerprint})}::jsonb) where id=${operation} and task_id=${task} and status='running'`;
  }
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
