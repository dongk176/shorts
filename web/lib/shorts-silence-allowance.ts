import "server-only";
import type { Sql, TransactionSql } from "postgres";

/** Automatic generation cleanup does not consume the one manual trial edit. */
export async function manualRenderVersion(db: Sql | TransactionSql, shortId: string,
  renderVersion: number, welcomeFunded: boolean) {
  if (!welcomeFunded || renderVersion < 2) return renderVersion;
  const [row] = await db`select exists (
    select 1 from shorts_mvp.admin_short_silence_tasks t
    join shorts_mvp.editor_render_requests r on r.id=t.request_id
    where t.short_id=${shortId} and r.short_id=t.short_id and r.user_id=t.user_id
      and t.cut_count>0 and r.base_render_version=1 and r.status='succeeded'
  ) as automatically_rendered`;
  return renderVersion - (row?.automaticallyRendered === true ? 1 : 0);
}
