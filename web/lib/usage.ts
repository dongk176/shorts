import type { Sql, TransactionSql } from "postgres";
import type { UsageSnapshot } from "@/lib/contracts";
import type { MvpSession } from "@/lib/session";

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
  session: MvpSession,
): Promise<UsageSnapshot> {
  const { start, next } = currentKstPeriod();
  const rows = await db`
    select
      p.monthly_source_seconds::int as limit_seconds,
      coalesce((
        select sum(e.source_duration_seconds)::int
        from shorts_mvp.usage_events e
        where (
          (${session.userId}::uuid is not null and e.user_id=${session.userId})
          or (${session.userId}::uuid is null and e.user_id is null and e.mvp_session_id=${session.id})
        )
          and e.event_type = 'source_consumed'
          and e.occurred_at >= ${start}
          and e.occurred_at < ${next}
      ), 0)::int as used_seconds,
      coalesce((
        select sum(r.source_duration_seconds)::int
        from shorts_mvp.usage_reservations r
        where (
          (${session.userId}::uuid is not null and r.user_id=${session.userId})
          or (${session.userId}::uuid is null and r.user_id is null and r.mvp_session_id=${session.id})
        ) and r.status = 'reserved'
      ), 0)::int as reserved_seconds
    from shorts_mvp.plans p
    where p.code = case
      when ${session.userId}::uuid is not null then (
        select selected_plan_code from shorts_mvp.app_users where id=${session.userId}
      )
      else (
        select selected_plan_code from shorts_mvp.mvp_sessions where id=${session.id}
      )
    end
  `;
  const row = rows[0] as { limitSeconds: number; usedSeconds: number; reservedSeconds: number } | undefined;
  if (!row) throw new Error("사용량 정보를 찾을 수 없습니다.");
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
