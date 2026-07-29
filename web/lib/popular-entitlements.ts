import type { Sql, TransactionSql } from "postgres";
import type { BillingSummary } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const POPULAR_FILTER_PLAN_MESSAGE =
  "실시간 인기 필터는 활성 구독 또는 기간 패키지를 이용할 때 사용할 수 있습니다.";

export function billingSupportsPopularFilters(
  billing: Pick<BillingSummary, "activeProducts">,
  hasDirectAccess = false,
  managedOverride: boolean | null = null,
) {
  if (managedOverride !== null) return managedOverride;
  return hasDirectAccess || billing.activeProducts.length > 0;
}

export function assertPopularFilterAccess(
  billing: Pick<BillingSummary, "activeProducts">,
  hasDirectAccess = false,
  managedOverride: boolean | null = null,
) {
  if (!billingSupportsPopularFilters(billing, hasDirectAccess, managedOverride)) {
    throw new HttpError(402, POPULAR_FILTER_PLAN_MESSAGE, "POPULAR_FILTER_PLAN_REQUIRED");
  }
}

export async function managedPopularFilterOverride(
  db: Sql | TransactionSql,
  userId: string,
): Promise<boolean | null> {
  const rows = await db`
    select popular_filter_enabled
    from shorts_mvp.managed_login_accounts
    where app_user_id=${userId} and is_active=true
    limit 1
  `;
  return rows[0] ? Boolean(rows[0].popularFilterEnabled) : null;
}

export async function hasDirectPopularFilterAccess(
  db: Sql | TransactionSql,
  userId: string,
) {
  const rows = await db`
    select 1
    from shorts_mvp.app_users account
    where account.id=${userId}
      and (
        (
          account.manual_service_access_until > clock_timestamp()
          and not exists (
            select 1
            from shorts_mvp.managed_login_accounts managed
            where managed.app_user_id=account.id
          )
        )
        or exists (
          select 1
          from shorts_mvp.managed_login_accounts managed
          where managed.app_user_id=account.id
            and managed.is_active=true
            and managed.popular_filter_enabled=true
        )
      )
    limit 1
  `;
  return Boolean(rows[0]);
}
