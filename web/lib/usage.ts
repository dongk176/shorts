import type { Sql, TransactionSql } from "postgres";
import { ADMIN_USAGE_GRANT_PRODUCT_CODE } from "@/lib/admin-usage-grant";
import type { UsageSnapshot } from "@/lib/contracts";
import { ONBOARDING_WELCOME_PRODUCT_CODE } from "@/lib/onboarding-welcome";
import { SHORTS_THANK_YOU_EVENT_PRODUCT_CODE } from "@/lib/shorts-thank-you-event";
import type { MvpSession } from "@/lib/session";

export function isPlanEnforcementEnabled() {
  return process.env.MVP_PLAN_ENFORCEMENT !== "false";
}

export function billableSourceSeconds(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("차감할 원본 영상 길이가 올바르지 않습니다.");
  }
  const wholeSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainderSeconds = wholeSeconds % 60;
  const billableMinutes = minutes + (remainderSeconds > 30 ? 1 : 0);
  return Math.max(60, billableMinutes * 60);
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
    with full_service_access as (
      select (
        exists (
          select 1
          from shorts_mvp.user_subscriptions subscription
          where subscription.user_id=${session.userId}
            and subscription.status='active'
            and subscription.current_period_start<=clock_timestamp()
            and subscription.current_period_end>clock_timestamp()
        )
        or exists (
          select 1
          from shorts_mvp.app_users account
          where account.id=${session.userId}
            and account.manual_service_access_until>clock_timestamp()
        )
      ) as enabled
    ), current_base as (
      select
        coalesce(sum(g.total_seconds),0)::int as total_seconds,
        coalesce(sum(g.consumed_seconds),0)::int as consumed_seconds,
        coalesce(sum(g.reserved_seconds),0)::int as reserved_seconds,
        max(g.valid_from) as valid_from,
        least(min(g.expires_at),min(s.next_quota_at)) as next_reset_at
      from shorts_mvp.usage_grants g
      join shorts_mvp.user_subscriptions s on s.id=g.subscription_id
      where g.user_id=${session.userId} and g.kind='base' and g.status='active'
        and g.valid_from <= clock_timestamp() and g.expires_at > clock_timestamp()
        and s.status='active' and s.current_period_start <= clock_timestamp()
        and s.current_period_end > clock_timestamp()
    ), active_addons as (
      select coalesce(sum(grant_row.total_seconds),0)::int as total_seconds,
        coalesce(sum(grant_row.consumed_seconds),0)::int as consumed_seconds,
        coalesce(sum(grant_row.reserved_seconds),0)::int as reserved_seconds
      from shorts_mvp.usage_grants grant_row
      cross join full_service_access service_access
      where grant_row.user_id=${session.userId}
        and grant_row.kind='addon' and grant_row.status='active'
        and grant_row.valid_from <= clock_timestamp()
        and grant_row.expires_at > clock_timestamp()
        and (
          service_access.enabled
          or grant_row.product_code in (
            ${ONBOARDING_WELCOME_PRODUCT_CODE},
            ${SHORTS_THANK_YOU_EVENT_PRODUCT_CODE},
            ${ADMIN_USAGE_GRANT_PRODUCT_CODE}
          )
        )
    )
    select
      coalesce(b.total_seconds,0)::int as base_limit_seconds,
      coalesce(b.consumed_seconds,0)::int as base_used_seconds,
      coalesce(b.reserved_seconds,0)::int as base_reserved_seconds,
      a.total_seconds as addon_limit_seconds,
      a.consumed_seconds as addon_used_seconds,
      a.reserved_seconds as addon_reserved_seconds,
      b.valid_from as period_start,
      b.next_reset_at
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
