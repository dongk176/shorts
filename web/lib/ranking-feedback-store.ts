import "server-only";
import { getDb } from "@/lib/db";

export async function loadRankingFeedback(query: string) {
  const db = getDb();
  return db`
    select f.operation_id,f.rating,f.comment,f.created_at,u.display_name,
      o.project_id
    from shorts_mvp.ranking_feedback f
    join shorts_mvp.app_users u on u.id=f.user_id
    join shorts_mvp.ranking_operations o on o.id=f.operation_id
    where f.rating is not null and (${query}='' or coalesce(u.display_name,'') ilike ${`%${query}%`} or f.comment ilike ${`%${query}%`})
    order by f.created_at desc limit 100
  `;
}
