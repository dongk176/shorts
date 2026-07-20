import type { Sql, TransactionSql } from "postgres";
import type { UsageSnapshot } from "@/lib/contracts";
import type { MvpSession } from "@/lib/session";

export function isPlanEnforcementEnabled() {
  return process.env.MVP_PLAN_ENFORCEMENT === "true";
}

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
  const enforcementEnabled = isPlanEnforcementEnabled();
  if (!session.userId) {
    return {
      usedSeconds: 0,
      reservedSeconds: 0,
      limitSeconds: 0,
      remainingSeconds: 0,
      baseUsedSeconds: 0,
      baseReservedSeconds: 0,
      baseLimitSeconds: 0,
      baseRemainingSeconds: 0,
      addonRemainingSeconds: 0,
      periodStart: start.toISOString(),
      nextResetAt: next.toISOString(),
      enforcementEnabled,
    };
  }
  const rows = await db`
    with current_base as (
      select g.* from shorts_mvp.usage_grants g
      join shorts_mvp.user_subscriptions s on s.id=g.subscription_id
      where g.user_id=${session.userId} and g.kind='base' and g.status='active'
        and g.valid_from <= clock_timestamp() and g.expires_at > clock_timestamp()
        and s.status='active' and s.current_period_start <= clock_timestamp()
        and s.current_period_end > clock_timestamp()
      order by g.valid_from desc limit 1
    ), active_addons as (
      select coalesce(sum(total_seconds),0)::int as total_seconds,
        coalesce(sum(consumed_seconds),0)::int as consumed_seconds,
        coalesce(sum(reserved_seconds),0)::int as reserved_seconds
      from shorts_mvp.usage_grants
      where user_id=${session.userId} and kind='addon' and status='active'
        and valid_from <= clock_timestamp() and expires_at > clock_timestamp()
    )
    select
      coalesce(b.total_seconds,0)::int as base_limit_seconds,
      coalesce(b.consumed_seconds,0)::int as base_used_seconds,
      coalesce(b.reserved_seconds,0)::int as base_reserved_seconds,
      a.total_seconds as addon_limit_seconds,
      a.consumed_seconds as addon_used_seconds,
      a.reserved_seconds as addon_reserved_seconds,
      b.valid_from as period_start,
      b.expires_at as next_reset_at
    from active_addons a
    left join current_base b on true
  `;
  const row = rows[0] as {
    baseLimitSeconds: number;
    baseUsedSeconds: number;
    baseReservedSeconds: number;
    addonLimitSeconds: number;
    addonUsedSeconds: number;
    addonReservedSeconds: number;
    periodStart: Date | null;
    nextResetAt: Date | null;
  };
  const baseRemainingSeconds = Math.max(0, row.baseLimitSeconds-row.baseUsedSeconds-row.baseReservedSeconds);
  const addonRemainingSeconds = Math.max(0, row.addonLimitSeconds-row.addonUsedSeconds-row.addonReservedSeconds);
  const usedSeconds = row.baseUsedSeconds+row.addonUsedSeconds;
  const reservedSeconds = row.baseReservedSeconds+row.addonReservedSeconds;
  return {
    usedSeconds,
    reservedSeconds,
    limitSeconds: row.baseLimitSeconds+row.addonLimitSeconds,
    remainingSeconds: baseRemainingSeconds+addonRemainingSeconds,
    baseUsedSeconds: row.baseUsedSeconds,
    baseReservedSeconds: row.baseReservedSeconds,
    baseLimitSeconds: row.baseLimitSeconds,
    baseRemainingSeconds,
    addonRemainingSeconds,
    periodStart: (row.periodStart || start).toISOString(),
    nextResetAt: (row.nextResetAt || next).toISOString(),
    enforcementEnabled,
  };
}
