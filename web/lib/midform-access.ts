import "server-only";
import { requireMidformAdmin } from "./midform-release";
import { getBillingSummary } from "@/lib/billing";
import { ensureReadDbReady, getDb } from "@/lib/db";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import { HttpError } from "@/lib/http";
import { midformCloudEnabled } from "@/lib/midform-cloud";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function midformAccess(request: Request) {
  if (!midformCloudEnabled()) throw new HttpError(404, "찾을 수 없습니다.");
  if (request.method !== "GET" && (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") === "cross-site")) {
    throw new HttpError(403, "이지컷 화면에서 다시 시도해 주세요.");
  }
  const started = performance.now();
  const trace = (stage: string) => console.info("midform_access_stage", { stage, elapsedMs: Math.round(performance.now() - started) });
  trace("start");
  // Recover stale serverless pools on reads before session/billing queries.
  // Write requests are never replayed automatically.
  if (request.method === "GET") await ensureReadDbReady();
  trace("db_ready");
  const session = await requireAuthenticatedMvpSession();
  trace("session_ready");
  if (session.isAdmin !== true) throw new HttpError(404, "찾을 수 없습니다.");
  const db = getDb();
  await requireMidformAdmin(db, session.userId);
  await assertEnterpriseSessionServiceAccess(db, session);
  trace("enterprise_ready");
  assertPaidProjectActionAccess(await getBillingSummary(db, session.userId), "edit");
  trace("billing_ready");
  return { session, db };
}
