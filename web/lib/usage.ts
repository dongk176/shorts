import type { Sql, TransactionSql } from "postgres";
import type { UsageSnapshot } from "@/lib/contracts";

export function currentKstPeriod(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1) - 9 * 60 * 60 * 1000);
  const next = new Date(Date.UTC(year, month + 1, 1) - 9 * 60 * 60 * 1000);
  return { start, next };
}

export async function getUsageSnapshot(
  db: Sql | TransactionSql,
  sessionId: string,
): Promise<UsageSnapshot> {
  const { start, next } = currentKstPeriod();
  const rows = await db`
    select
      p.monthly_source_seconds::int as limit_seconds,
      coalesce((
        select sum(e.source_duration_seconds)::int
        from shorts_mvp.usage_events e
        where e.mvp_session_id = s.id
          and e.event_type = 'source_consumed'
          and e.occurred_at >= ${start}
          and e.occurred_at < ${next}
      ), 0)::int as used_seconds,
      coalesce((
        select sum(r.source_duration_seconds)::int
        from shorts_mvp.usage_reservations r
        where r.mvp_session_id = s.id and r.status = 'reserved'
      ), 0)::int as reserved_seconds
    from shorts_mvp.mvp_sessions s
    join shorts_mvp.plans p on p.code = s.selected_plan_code
    where s.id = ${sessionId}
  `;
  const row = rows[0] as { limitSeconds: number; usedSeconds: number; reservedSeconds: number };
  return {
    usedSeconds: row.usedSeconds,
    reservedSeconds: row.reservedSeconds,
    limitSeconds: row.limitSeconds,
    remainingSeconds: Math.max(0, row.limitSeconds - row.usedSeconds - row.reservedSeconds),
    periodStart: start.toISOString(),
    nextResetAt: next.toISOString(),
    enforcementEnabled: process.env.MVP_PLAN_ENFORCEMENT === "true",
  };
}
