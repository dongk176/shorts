import "server-only";
import { getDb } from "./db";
import { rankingEnabled } from "./ranking-access";

export type RankingProjectSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  status: "draft" | "queued" | "running" | "succeeded" | "failed";
  operationId: string | null;
  duration: number | null;
};

// This optional list must never broaden the ordinary projects page's access.
// Match the authenticated identity to its current administrator row in SQL.
export async function loadRankingProjectList(
  authUserId: string | null,
): Promise<RankingProjectSummary[]> {
  if (!authUserId || !rankingEnabled()) return [];
  const rows = await getDb()`
    select p.id,p.draft->>'title' as title,p.created_at,
      coalesce(o.status,'draft') as status,o.id as operation_id,
      case when o.status='succeeded' then o.result->>'duration' end as duration
    from shorts_mvp.app_users u
    join shorts_mvp.ranking_projects p on p.user_id=u.id
    left join lateral (
      select id,status,result from shorts_mvp.ranking_operations
      where project_id=p.id and action='render'
      order by created_at desc,id desc limit 1
    ) o on true
    where u.auth_user_id=${authUserId} and u.is_admin=true
      and p.deleted_at is null and p.expires_at>now()
    order by p.created_at desc,p.id desc limit 20
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt).toISOString(),
    status: row.status,
    operationId: row.operationId,
    duration: row.duration == null ? null : Number(row.duration),
  }));
}
